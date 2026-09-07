/* Uniswap V4 on Arc.
 *
 * A different animal from V3, and the differences are the ones that bite:
 *
 *   - Every pool lives inside one PoolManager, so a pool is a 32-byte id, not
 *     an address. `balanceOf` on the manager returns the SAME number for every
 *     pool on the chain — it does not give a wrong answer, it gives an
 *     undiscriminating one, which is worse.
 *   - Liquidity is added through the PositionManager as an encoded list of
 *     actions, not a function call per step.
 *   - Tokens are moved via Permit2, so an ERC-20 approval alone is not enough:
 *     you approve Permit2, then Permit2 approves the PositionManager.
 *   - And pools can have a HOOK: a contract of your own that runs on every
 *     swap and every liquidity change. That is the thing V3 cannot do at all.
 *
 * Every address below was checked with eth_getCode on Arc, and the three that
 * expose poolManager() were asked, so they are known to point at the same
 * singleton rather than assumed to.
 */

export const V4 = {
  poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  positionManager: "0x6049c9a0e26405c0985f9e3685c87d0ae917f82b",
  stateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
  quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  universalRouter: "0x4fca4a51ab4f23a7447b3284fbd7d73289a89fb1",
};

/* v4-periphery's Actions enum. Only the four this page needs. */
const MINT_POSITION = "02";
const SETTLE_PAIR = "0d";
const DECREASE_LIQUIDITY = "01";
const TAKE_PAIR = "11";

export const POSM_ABI = [
  "function initializePool((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key, uint160 sqrtPriceX96) returns (int24)",
  "function modifyLiquidities(bytes unlockData, uint256 deadline) payable",
  "function multicall(bytes[] data) payable returns (bytes[])",
  "function nextTokenId() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function getPoolAndPositionInfo(uint256 tokenId) view returns ((address,address,uint24,int24,address) key, uint256 info)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
];
export const PERMIT2_ABI = [
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
];
export const STATEVIEW_ABI = [
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
];

/* V4 fee tiers are not a fixed menu the way V3's are — the fee is just a number
 * in the key, and any tickSpacing is legal. These are the conventional pairings
 * and the ones other launchpads here use; the page lets you type your own. */
export const V4_TIERS = [
  { fee: 100, tickSpacing: 1, label: "0.01%", hint: "Stable pairs." },
  { fee: 500, tickSpacing: 10, label: "0.05%", hint: "Correlated assets." },
  { fee: 3000, tickSpacing: 60, label: "0.30%", hint: "The usual choice." },
  { fee: 10000, tickSpacing: 200, label: "1.00%", hint: "Volatile or brand new. Every V4 pool on Arc today uses this." },
];

/* THE ORDERING TRAP, and it is not a rare case.
 *
 * currency0 is simply the lower address. Arc's USDC starts 0x36, so roughly one
 * token in five sorts BELOW it and the pair flips. Get it wrong and keccak
 * gives you a pool id that does not exist — no error, just nothing there.
 * Verified against fifteen live pools: all fifteen reconstruct exactly with
 * this, and two of them (a 0x20… and a 0x0d…) only match with the token first. */
export function poolKey(tokenA, tokenB, fee, tickSpacing, hooks) {
  const a = tokenA.toLowerCase(), b = tokenB.toLowerCase();
  const [c0, c1] = a < b ? [a, b] : [b, a];
  return {
    currency0: c0,
    currency1: c1,
    fee: Number(fee),
    tickSpacing: Number(tickSpacing),
    hooks: (hooks || ethers.ZeroAddress).toLowerCase(),
    aIsZero: a < b,
  };
}

/* poolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks)).
 * Five 32-byte words, NOT packed. */
export function poolId(key) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint24", "int24", "address"],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]
    )
  );
}

function keyTuple(key) {
  return [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks];
}

const Q96 = 2 ** 96;

function sqrtRatioAt(tick) {
  // Float is fine here: this feeds a liquidity figure that is bounded by the
  // amount0Max/amount1Max the user typed, so a last-digit difference changes
  // how much is pulled by a hair and can never pull more than the ceiling.
  return Math.pow(1.0001, tick / 2) * Q96;
}

/* How much liquidity a pair of amounts buys, given where the price is relative
 * to the range. Below the range the position is all currency0, above it all
 * currency1 — which is exactly why a one-sided range needs only one token. */
export function liquidityFor(sqrtP, tickLower, tickUpper, amount0, amount1) {
  const A = sqrtRatioAt(tickLower);
  const B = sqrtRatioAt(tickUpper);
  const P = Math.max(A, Math.min(B, sqrtP));
  const a0 = Number(amount0), a1 = Number(amount1);

  const fromAmount0 = (lo, hi) => (hi <= lo ? 0 : (a0 * (lo * hi)) / (Q96 * (hi - lo)));
  const fromAmount1 = (lo, hi) => (hi <= lo ? 0 : (a1 * Q96) / (hi - lo));

  let L;
  if (sqrtP <= A) L = fromAmount0(A, B);
  else if (sqrtP >= B) L = fromAmount1(A, B);
  else L = Math.min(fromAmount0(P, B), fromAmount1(A, P));

  if (!isFinite(L) || L <= 0) return 0n;
  return BigInt(Math.floor(L));
}

/* MINT_POSITION then SETTLE_PAIR: create the position, then pay for it. The
 * two are one atomic unlock — the manager will not let the transaction end
 * with a debt outstanding, which is what SETTLE_PAIR clears. */
export function encodeMint(key, tickLower, tickUpper, liquidity, amount0Max, amount1Max, owner, hookData = "0x") {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const actions = "0x" + MINT_POSITION + SETTLE_PAIR;
  const params = [
    abi.encode(
      ["(address,address,uint24,int24,address)", "int24", "int24", "uint256", "uint128", "uint128", "address", "bytes"],
      [keyTuple(key), tickLower, tickUpper, liquidity, amount0Max, amount1Max, owner, hookData]
    ),
    abi.encode(["address", "address"], [key.currency0, key.currency1]),
  ];
  return abi.encode(["bytes", "bytes[]"], [actions, params]);
}

/* DECREASE_LIQUIDITY then TAKE_PAIR: pull the liquidity out, then collect both
 * sides. Passing the full liquidity empties the position without burning the
 * NFT, so it can be topped up again later. */
export function encodeDecrease(tokenId, liquidity, amount0Min, amount1Min, recipient, hookData = "0x") {
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const actions = "0x" + DECREASE_LIQUIDITY + TAKE_PAIR;
  const params = [
    abi.encode(["uint256", "uint256", "uint128", "uint128", "bytes"], [tokenId, liquidity, amount0Min, amount1Min, hookData]),
    abi.encode(["address", "address", "address"], [/* filled by caller */ ethers.ZeroAddress, ethers.ZeroAddress, recipient]),
  ];
  return abi.encode(["bytes", "bytes[]"], [actions, params]);
}

/* Permit2 is two approvals, and skipping the first is the usual mistake: the
 * ERC-20 allowance goes to PERMIT2, and then Permit2 is told which spender may
 * draw on it and until when. Approving the PositionManager directly on the
 * token does nothing at all here. */
export async function permit2Steps(ethersLib, signer, token, amount, log) {
  const erc20 = new ethersLib.Contract(token, [
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
  ], signer);
  const owner = await signer.getAddress();

  const cur = await erc20.allowance(owner, V4.permit2);
  if (cur < amount) {
    log("approving Permit2 to move " + token.slice(0, 10) + "…");
    await (await erc20.approve(V4.permit2, amount)).wait();
  } else {
    log("Permit2 already allowed on " + token.slice(0, 10) + "…");
  }

  const p2 = new ethersLib.Contract(V4.permit2, PERMIT2_ABI, signer);
  const [allowed, expiry] = await p2.allowance(owner, token, V4.positionManager);
  const ahora = Math.floor(Date.now() / 1000);
  if (allowed < amount || Number(expiry) < ahora + 600) {
    // 30 days. A permanent expiry is a standing licence to move the tokens.
    const exp = ahora + 30 * 24 * 3600;
    log("letting the position manager draw on it, for 30 days");
    await (await p2.approve(token, V4.positionManager, amount, exp)).wait();
  } else {
    log("position manager already allowed");
  }
}

export const HOOK_NOTE =
  "A hook is a contract of your own that the pool calls on every swap and every " +
  "liquidity change. It can take a fee, refuse a trade, rewrite the price curve, " +
  "or do nothing at all. Leave it at the zero address for a normal pool. " +
  "The address is not checked here and a wrong one makes a pool nobody can use — " +
  "V4 also reads permissions out of the address's own low bits, so a contract " +
  "deployed to the wrong address will not be called the way you expect.";
