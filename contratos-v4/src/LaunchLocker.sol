// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// Minimal ERC721 surface of the PositionManager we need.
interface IERC721Owner {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title LaunchLocker
/// @notice Permanent home for every launch's Uniswap v4 position NFT, and the
/// fee splitter for the trading fees that position earns.
///
/// Mechanics:
///   - The factory mints each launch's single-sided position directly to this
///     contract and then calls `register()` with the quote and fee recipients.
///   - Anyone can call `collect(tokenId)`: it pulls accrued LP fees (the quote
///     — native ETH or an ERC20 — and the launch token) out of the PoolManager
///     and pays 100% of them to the launch's recipients by basis points.
///     There is NO platform cut: this contract has no fee address, no fee
///     variable, and no code path that pays anyone but the recipients.
///   - Payout is PUSH-first: each share is sent to its recipient during
///     `collect`. If a recipient cannot receive (a contract without a payable
///     fallback, a blocklisted address for an ERC20 quote), that share is
///     CREDITED instead and can be pulled later with `claim` — so one bad
///     recipient can never block the others, and nothing is ever lost.
///   - A recipient equal to `DEAD` (0x…dEaD) is a BURN: its share is sent to
///     the dead address immediately during `collect` instead of being
///     credited. A launch with no beneficiary at all is registered by the
///     factory as `[DEAD: 100%]`, so its fees are burned in full.
///
/// Trust properties, deliberately:
///   - No owner, no admin, no upgradeability, no pause.
///   - There is NO function that transfers, approves, burns, or decreases the
///     liquidity of a position NFT. Once minted here, liquidity is locked for
///     the life of the chain. `collect` only ever removes ZERO liquidity.
///   - Recipients are fixed at `register()` time and cannot be changed.
///   - Accounting is balance-based (`balance - reserved`), so stray ETH or
///     tokens sent here are swept to the next collect instead of stranding.
contract LaunchLocker is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Recipient {
        address payout;
        uint16 bps;
    }

    struct Position {
        address token;
        address quote; // NATIVE or ERC20
        Recipient[] recipients;
    }

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_RECIPIENTS = 7;
    /// Currency key used for native ETH in `claimable` / `reserved`.
    address public constant NATIVE = address(0);
    /// Recipient address that means "burn this share".
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IPositionManager public immutable positionManager;
    address public immutable factory;

    mapping(uint256 tokenId => Position) internal _positions;
    /// Launch token → position NFT id (0 = unknown; PositionManager ids start at 1).
    mapping(address token => uint256 tokenId) public tokenIdOf;
    /// account → currency (NATIVE or token address) → amount claimable.
    mapping(address account => mapping(address currency => uint256)) public claimable;
    /// currency → total credited but not yet claimed. `balance - reserved` is
    /// what the next `collect` distributes.
    mapping(address currency => uint256) public reserved;

    event Registered(uint256 indexed tokenId, address indexed token, address indexed quote, Recipient[] recipients);
    event Collected(uint256 indexed tokenId, address indexed token, uint256 quoteAmount, uint256 tokenAmount);
    event Credited(address indexed account, address indexed currency, uint256 amount);
    event Claimed(address indexed account, address indexed currency, uint256 amount);
    event Paid(uint256 indexed tokenId, address indexed account, address indexed currency, uint256 amount);
    event Burned(uint256 indexed tokenId, address indexed currency, uint256 amount);

    error NotFactory();
    error AlreadyRegistered();
    error UnknownPosition();
    error NotPositionOwner();
    error BadRecipients();
    error EthTransferFailed();

    constructor(IPositionManager positionManager_) {
        positionManager = positionManager_;
        factory = msg.sender;
    }

    /// PoolManager pays native-ETH fees here during `collect`. Anything else
    /// that lands here is swept into the next distribution.
    receive() external payable {}

    /// Accept position NFTs (PositionManager uses a non-checking mint, but be explicit).
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // ── Factory-only ─────────────────────────────────────────────────────────

    /// @notice Bind a freshly minted position to its quote and fee recipients.
    /// Called once per launch by the factory, in the same transaction as the mint.
    function register(uint256 tokenId, address token, address quote, Recipient[] calldata recipients) external {
        if (msg.sender != factory) revert NotFactory();
        if (_positions[tokenId].token != address(0) || tokenIdOf[token] != 0) revert AlreadyRegistered();
        if (IERC721Owner(address(positionManager)).ownerOf(tokenId) != address(this)) revert NotPositionOwner();

        uint256 n = recipients.length;
        if (n == 0 || n > MAX_RECIPIENTS) revert BadRecipients();
        Position storage p = _positions[tokenId];
        p.token = token;
        p.quote = quote;
        uint256 total;
        for (uint256 i; i < n; ++i) {
            Recipient calldata r = recipients[i];
            if (r.payout == address(0) || r.bps == 0) revert BadRecipients();
            total += r.bps;
            p.recipients.push(r);
        }
        if (total != BPS) revert BadRecipients();
        tokenIdOf[token] = tokenId;
        emit Registered(tokenId, token, quote, recipients);
    }

    // ── Permissionless ───────────────────────────────────────────────────────

    /// @notice Pull accrued LP fees for a position out of the pool and credit
    /// them to its recipients. Removes ZERO liquidity — only fees move.
    function collect(uint256 tokenId) public nonReentrant returns (uint256 quoteOut, uint256 tokenOut) {
        Position storage p = _positions[tokenId];
        address token = p.token;
        if (token == address(0)) revert UnknownPosition();
        address quote = p.quote;

        bytes memory actions = abi.encodePacked(uint8(Actions.DECREASE_LIQUIDITY), uint8(Actions.TAKE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(Currency.wrap(quote), Currency.wrap(token), address(this));
        positionManager.modifyLiquidities(abi.encode(actions, params), block.timestamp);

        quoteOut = _distribute(tokenId, p, quote);
        tokenOut = _distribute(tokenId, p, token);
        emit Collected(tokenId, token, quoteOut, tokenOut);
    }

    /// @notice `collect` for several positions in one transaction.
    function collectMany(uint256[] calldata tokenIds) external {
        for (uint256 i; i < tokenIds.length; ++i) {
            collect(tokenIds[i]);
        }
    }

    /// @notice Withdraw everything credited to the caller in `currency`.
    function claim(address currency) external nonReentrant returns (uint256) {
        return _claim(msg.sender, currency);
    }

    /// @notice Push `account`'s credited balance to `account`. Anyone may call;
    /// funds only ever go to the account they are credited to.
    function claimFor(address account, address currency) external nonReentrant returns (uint256) {
        return _claim(account, currency);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function tokenOf(uint256 tokenId) external view returns (address) {
        return _positions[tokenId].token;
    }

    function quoteOf(uint256 tokenId) external view returns (address) {
        return _positions[tokenId].quote;
    }

    function recipientsOf(uint256 tokenId) external view returns (Recipient[] memory) {
        return _positions[tokenId].recipients;
    }

    // ── Internals ────────────────────────────────────────────────────────────

    function _distribute(uint256 tokenId, Position storage p, address currency) internal returns (uint256 amount) {
        uint256 bal = currency == NATIVE ? address(this).balance : IERC20(currency).balanceOf(address(this));
        amount = bal - reserved[currency];
        if (amount == 0) return 0;

        uint256 remaining = amount;
        uint256 settled; // burned or paid out during this call — already left the contract
        uint256 n = p.recipients.length;
        for (uint256 i; i < n; ++i) {
            Recipient storage r = p.recipients[i];
            // Last recipient absorbs rounding dust so shares always sum to `amount`.
            uint256 share = (i == n - 1) ? remaining : (amount * r.bps) / BPS;
            remaining -= share;
            if (r.payout == DEAD) {
                _burn(tokenId, currency, share);
                settled += share;
            } else if (_tryPay(currency, r.payout, share)) {
                emit Paid(tokenId, r.payout, currency, share);
                settled += share;
            } else {
                _credit(r.payout, currency, share);
            }
        }
        // Only credited shares stay here and must be reserved for their owners.
        reserved[currency] += amount - settled;
    }

    /// Best-effort push. Bounded gas for the ETH call so a griefing recipient
    /// cannot make `collect` unaffordable; ERC20 failures (revert / false
    /// return) are swallowed the same way. Returns false → caller credits.
    function _tryPay(address currency, address to, uint256 amount) internal returns (bool ok) {
        if (amount == 0) return true;
        if (currency == NATIVE) {
            (ok,) = to.call{value: amount, gas: 50_000}("");
        } else {
            (bool called, bytes memory ret) =
                address(currency).call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
            ok = called && (ret.length == 0 || abi.decode(ret, (bool)));
        }
    }

    /// Send `amount` of `currency` to the dead address. ETH to an EOA-like
    /// address cannot fail; an ERC20 that refuses transfers to DEAD would make
    /// `collect` revert for that launch only (its own quote choice).
    function _burn(uint256 tokenId, address currency, uint256 amount) internal {
        if (amount == 0) return;
        if (currency == NATIVE) {
            (bool ok,) = DEAD.call{value: amount}("");
            if (!ok) revert EthTransferFailed();
        } else {
            IERC20(currency).safeTransfer(DEAD, amount);
        }
        emit Burned(tokenId, currency, amount);
    }

    function _credit(address account, address currency, uint256 amount) internal {
        if (amount == 0) return;
        claimable[account][currency] += amount;
        emit Credited(account, currency, amount);
    }

    function _claim(address account, address currency) internal returns (uint256 amount) {
        amount = claimable[account][currency];
        if (amount == 0) return 0;
        claimable[account][currency] = 0;
        reserved[currency] -= amount;
        if (currency == NATIVE) {
            (bool ok,) = account.call{value: amount}("");
            if (!ok) revert EthTransferFailed();
        } else {
            IERC20(currency).safeTransfer(account, amount);
        }
        emit Claimed(account, currency, amount);
    }
}
