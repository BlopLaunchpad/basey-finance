// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {LaunchLocker} from "./LaunchLocker.sol";

interface IBaseyToken {
    function approve(address spender, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

interface IBaseyTokenEditable {
    function transferOwnership(address newOwner) external;
}

interface IERC20Min {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

interface IERC721Min {
    function ownerOf(uint256 tokenId) external view returns (address);
    function transferFrom(address from, address to, uint256 tokenId) external;
}

/// @title BaseyLaunchFactoryV4
/// @notice Step 6 of basey.finance on Uniswap v4, in ONE transaction:
///   1. deploys the token (BaseyToken or BaseyTokenEditable, byte-for-byte the
///      verified contract: its creation code is checked against two hashes fixed
///      at construction), with the full supply landing here;
///   2. initialises a USDC / token v4 pool (no hook) at `startTick`;
///   3. mints ONE single-sided sell wall of the token, [wallLower, wallUpper],
///      owned either by the LaunchLocker (locked for the life of the chain, fees
///      to the recipients) or by the launcher;
///   4. sends the rest of the supply (the treasury share, plus rounding) to the
///      launcher;
///   5. makes the launcher's first buy in the same transaction, so nobody can
///      buy in between the pool opening and the launcher.
///
/// The LaunchLocker it deploys is openlaunch.lol's contract copied verbatim
/// (github.com/Gitlawb/openlaunch, contracts/src/LaunchLocker.sol, MIT): no
/// function in it can withdraw, transfer, approve or burn a position, and
/// `collect` only ever removes ZERO liquidity. As in openlaunch, only the factory
/// that created the locker can `register` a position on it.
///
/// On Arc, USDC is both the native gas asset and the ERC20 at 0x3600…0000. As in
/// openlaunch's LaunchFactoryArc, pools use the ERC20 face only, and the token
/// must sort ABOVE it so USDC is always currency0: find a salt with `findSalt`.
///
/// Trust properties:
///   - No owner, no admin, no upgradeability, no pause, no fee: the factory takes
///     nothing from a launch and holds nothing after it.
///   - The launcher is the one who signs: tokens, the treasury share, the first
///     buy and (for BaseyTokenEditable) ownership all go to msg.sender.
contract BaseyLaunchFactoryV4 is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    struct LaunchParams {
        bytes tokenInitCode; // creation code of BaseyToken or BaseyTokenEditable (hash-checked)
        string name;
        string symbol;
        uint256 wholeSupply; // whole tokens; the token multiplies by 10**18
        string metadataJSON;
        string logo;
        string description;
        bytes32 salt; // scoped to msg.sender; the token must sort above USDC (see findSalt)
        uint24 lpFee; // pips, 0 <= lpFee <= MAX_LP_FEE (10_000 = 1%)
        int24 startTick; // opening price, any tick in range (the pool opens at the exact price)
        int24 wallLower; // wall range, multiples of TICK_SPACING,
        int24 wallUpper; //   minUsableTick <= wallLower < wallUpper <= startTick
        uint256 wallTokens; // raw token units in the wall; everything else goes to the launcher
        bool lockWall; // true: the wall is minted to the LaunchLocker and registered
        LaunchLocker.Recipient[] recipients; // fee recipients when locked; empty = the launcher, 100%
        uint256 buyUsdc; // first buy in raw USDC (6 decimals), pulled from the launcher; 0 = none
        uint256 minTokensOut; // the first buy reverts the whole launch below this
    }

    struct Info {
        uint256 tokenId;
        address launcher;
        int24 startTick;
        uint24 lpFee;
        bool locked;
        uint128 liquidity; // the wall's liquidity as minted; lockPosition wants all of it still there
    }

    int24 public constant TICK_SPACING = 200;
    uint24 public constant MAX_LP_FEE = 30_000; // 3%

    IPoolManager public immutable poolManager;
    IPositionManager public immutable positionManager;
    IAllowanceTransfer public immutable permit2;
    address public immutable usdc;
    LaunchLocker public immutable locker;
    bytes32 public immutable tokenCodeHash;
    bytes32 public immutable editableCodeHash;

    mapping(address token => Info) public infoOf;
    uint256 public launchCount;

    uint256 private _entered;
    bool private _swapping;

    event Launched(
        address indexed token,
        uint256 indexed tokenId,
        address indexed launcher,
        PoolId poolId,
        int24 startTick,
        uint24 lpFee,
        uint256 supply,
        uint256 wallTokens,
        bool locked,
        uint256 buyUsdc,
        uint256 tokensBought
    );
    event Locked(address indexed token, uint256 indexed tokenId, address indexed by);

    error Reentrant();
    error UnknownTokenCode();
    error BadFee();
    error BadTicks();
    error BadWall();
    error SaltUsed();
    error QuoteOrdering();
    error DeployFailed();
    error NoLiquidity();
    error Slippage();
    error NotPoolManager();
    error NotOurLaunch();
    error NotPositionOwner();
    error WallNotIntact();
    error NoSaltFound();
    error TransferFailed();

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrant();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(
        IPoolManager poolManager_,
        IPositionManager positionManager_,
        IAllowanceTransfer permit2_,
        address usdc_,
        bytes32 tokenCodeHash_,
        bytes32 editableCodeHash_
    ) {
        poolManager = poolManager_;
        positionManager = positionManager_;
        permit2 = permit2_;
        usdc = usdc_;
        tokenCodeHash = tokenCodeHash_;
        editableCodeHash = editableCodeHash_;
        locker = new LaunchLocker(positionManager_);
    }

    /// @notice Launch a token, its pool, its wall and the first buy. See the contract notes.
    function launch(LaunchParams calldata p)
        external
        nonReentrant
        returns (address token, uint256 tokenId, uint256 tokensBought)
    {
        bytes32 codeHash = keccak256(p.tokenInitCode);
        bool editable = codeHash == editableCodeHash;
        if (!editable && codeHash != tokenCodeHash) revert UnknownTokenCode();
        if (p.lpFee > MAX_LP_FEE) revert BadFee();
        _checkTicks(p.startTick, p.wallLower, p.wallUpper);

        // 1. the token, by CREATE2. The address is checked BEFORE deploying: a
        //    CREATE2 collision would burn the whole gas limit.
        bytes memory init = abi.encodePacked(
            p.tokenInitCode, abi.encode(p.name, p.symbol, p.wholeSupply, p.metadataJSON, p.logo, p.description)
        );
        bytes32 scoped = keccak256(abi.encode(msg.sender, p.salt));
        {
            address predicted = _predict(scoped, keccak256(init));
            if (predicted.code.length != 0) revert SaltUsed();
            if (uint160(predicted) <= uint160(usdc)) revert QuoteOrdering();
        }
        assembly ("memory-safe") {
            token := create2(0, add(init, 0x20), mload(init), scoped)
        }
        if (token == address(0)) revert DeployFailed();
        uint256 supply = IBaseyToken(token).totalSupply();
        if (p.wallTokens == 0 || p.wallTokens > supply || p.wallTokens > type(uint128).max) revert BadWall();
        if (editable) IBaseyTokenEditable(token).transferOwnership(msg.sender);

        // 2. the pool, at the opening price
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(usdc),
            currency1: Currency.wrap(token),
            fee: p.lpFee,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        poolManager.initialize(key, TickMath.getSqrtPriceAtTick(p.startTick));

        // 3. the wall: token only, entirely at or below the current tick
        uint128 wallLiquidity;
        (tokenId, wallLiquidity) =
            _mintWall(key, p.wallLower, p.wallUpper, p.wallTokens, p.lockWall ? address(locker) : msg.sender);
        if (p.lockWall) locker.register(tokenId, token, usdc, _recipients(p.recipients));

        // 4. the rest of the supply (treasury share and rounding) to the launcher
        uint256 rest = IBaseyToken(token).balanceOf(address(this));
        if (rest != 0 && !IBaseyToken(token).transfer(msg.sender, rest)) revert TransferFailed();

        // 5. the first buy, in this same transaction
        if (p.buyUsdc != 0) tokensBought = _firstBuy(key, p.buyUsdc, p.minTokensOut, TickMath.getSqrtPriceAtTick(p.wallLower));

        infoOf[token] = Info({
            tokenId: tokenId,
            launcher: msg.sender,
            startTick: p.startTick,
            lpFee: p.lpFee,
            locked: p.lockWall,
            liquidity: wallLiquidity
        });
        unchecked {
            ++launchCount;
        }
        emit Launched(
            token, tokenId, msg.sender, key.toId(), p.startTick, p.lpFee, supply, p.wallTokens, p.lockWall, p.buyUsdc, tokensBought
        );
    }

    /// @notice Lock, later, the wall of a token launched here: the position moves to
    /// the LaunchLocker for good and its fees go to the recipients (empty = you).
    /// The caller must own the position and have approved this factory for it.
    /// Only THE wall this factory minted qualifies: the locker takes one position per
    /// token, so accepting any USDC/token position would let anyone lock a dust
    /// position from a pool of their own first and shut the real wall out for good.
    /// And only while it is WHOLE: an owner who took liquidity out (buyers' USDC
    /// included) and then locked what was left would get a "locked" wall that is
    /// really a rug, and a wall emptied to zero makes the locker's collect revert.
    function lockPosition(uint256 tokenId, LaunchLocker.Recipient[] calldata recipients) external nonReentrant {
        (PoolKey memory key,) = positionManager.getPoolAndPositionInfo(tokenId);
        address token = Currency.unwrap(key.currency1);
        Info storage info = infoOf[token];
        if (Currency.unwrap(key.currency0) != usdc || info.launcher == address(0) || info.tokenId != tokenId) {
            revert NotOurLaunch();
        }
        if (IERC721Min(address(positionManager)).ownerOf(tokenId) != msg.sender) revert NotPositionOwner();
        if (positionManager.getPositionLiquidity(tokenId) < info.liquidity) revert WallNotIntact();
        IERC721Min(address(positionManager)).transferFrom(msg.sender, address(locker), tokenId);
        locker.register(tokenId, token, usdc, _recipients(recipients));
        info.locked = true;
        emit Locked(token, tokenId, msg.sender);
    }

    /// @notice The first buy's swap. Only the PoolManager, and only inside our own unlock.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || !_swapping) revert NotPoolManager();
        (PoolKey memory key, uint256 amountIn, address to, uint160 limit) =
            abi.decode(data, (PoolKey, uint256, address, uint160));
        BalanceDelta delta = poolManager.swap(
            key, SwapParams({zeroForOne: true, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: limit}), ""
        );
        // exact input, USDC -> token: amount0 is what we owe (<= 0), amount1 what we get (>= 0)
        uint256 paid = uint256(uint128(-delta.amount0()));
        uint256 got = uint256(uint128(delta.amount1()));
        if (paid != 0) {
            poolManager.sync(key.currency0);
            if (!IERC20Min(usdc).transfer(address(poolManager), paid)) revert TransferFailed();
            poolManager.settle();
        }
        if (got != 0) poolManager.take(key.currency1, to, got);
        return abi.encode(paid, got);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    /// @notice The address a `launch()` from `launcher` would give the token.
    function predictToken(address launcher, bytes32 salt, bytes calldata tokenInitCode, bytes calldata constructorArgs)
        external
        view
        returns (address)
    {
        return _predict(keccak256(abi.encode(launcher, salt)), keccak256(abi.encodePacked(tokenInitCode, constructorArgs)));
    }

    /// @notice A salt (derived from `baseSalt`) whose token sorts above USDC and is
    /// still free. Pure hashing: one eth_call. `constructorArgs` is the ABI-encoded
    /// (name, symbol, wholeSupply, metadataJSON, logo, description).
    function findSalt(
        address launcher,
        bytes32 baseSalt,
        bytes calldata tokenInitCode,
        bytes calldata constructorArgs,
        uint256 maxTries
    ) external view returns (bytes32 salt, address token) {
        bytes32 initHash = keccak256(abi.encodePacked(tokenInitCode, constructorArgs));
        for (uint256 i; i < maxTries; ++i) {
            salt = i == 0 ? baseSalt : keccak256(abi.encode(baseSalt, i));
            token = _predict(keccak256(abi.encode(launcher, salt)), initHash);
            if (uint160(token) > uint160(usdc) && token.code.length == 0) return (salt, token);
        }
        revert NoSaltFound();
    }

    // ── Internals ────────────────────────────────────────────────────────────

    /// The wall's edges sit on the spacing; the opening tick need not (v4 opens at any
    /// price), so the pool opens at the plan's price to within one tick.
    function _checkTicks(int24 startTick, int24 wallLower, int24 wallUpper) internal pure {
        int24 minTick = TickMath.minUsableTick(TICK_SPACING);
        int24 maxTick = TickMath.maxUsableTick(TICK_SPACING);
        if (
            wallLower % TICK_SPACING != 0 || wallUpper % TICK_SPACING != 0 || wallLower < minTick
                || wallLower >= wallUpper || wallUpper > startTick || startTick > maxTick
        ) revert BadTicks();
    }

    function _mintWall(PoolKey memory key, int24 wallLower, int24 wallUpper, uint256 wallTokens, address owner_)
        internal
        returns (uint256 tokenId, uint128 liquidity)
    {
        liquidity = LiquidityAmounts.getLiquidityForAmount1(
            TickMath.getSqrtPriceAtTick(wallLower), TickMath.getSqrtPriceAtTick(wallUpper), wallTokens
        );
        if (liquidity == 0) revert NoLiquidity();
        address token = Currency.unwrap(key.currency1);
        IBaseyToken(token).approve(address(permit2), wallTokens);
        permit2.approve(token, address(positionManager), uint160(wallTokens), uint48(block.timestamp));

        tokenId = positionManager.nextTokenId();
        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, wallLower, wallUpper, uint256(liquidity), uint128(0), uint128(wallTokens), owner_, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);
        IBaseyToken(token).approve(address(permit2), 0);
    }

    function _firstBuy(PoolKey memory key, uint256 buyUsdc, uint256 minTokensOut, uint160 limit)
        internal
        returns (uint256 got)
    {
        if (!IERC20Min(usdc).transferFrom(msg.sender, address(this), buyUsdc)) revert TransferFailed();
        _swapping = true;
        bytes memory r = poolManager.unlock(abi.encode(key, buyUsdc, msg.sender, limit));
        _swapping = false;
        uint256 paid;
        (paid, got) = abi.decode(r, (uint256, uint256));
        if (got < minTokensOut) revert Slippage();
        // a buy bigger than the wall stops at its bottom: the unspent USDC goes back
        if (paid < buyUsdc && !IERC20Min(usdc).transfer(msg.sender, buyUsdc - paid)) revert TransferFailed();
    }

    function _recipients(LaunchLocker.Recipient[] calldata given)
        internal
        view
        returns (LaunchLocker.Recipient[] memory r)
    {
        if (given.length != 0) return given;
        r = new LaunchLocker.Recipient[](1);
        r[0] = LaunchLocker.Recipient({payout: msg.sender, bps: uint16(locker.BPS())});
    }

    function _predict(bytes32 scopedSalt, bytes32 initHash) internal view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), scopedSalt, initHash)))));
    }
}
