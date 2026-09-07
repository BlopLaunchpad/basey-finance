/* Token feature matrix.
 *
 * Every switch a launcher can flip, what it actually does, and what it costs
 * the people who buy the token. The risk text is the point of this file: a
 * launcher should not be able to enable a honeypot switch without reading, in
 * plain words, what it lets them do.
 *
 * Where we have first-hand evidence, it is cited. The transfer-tax entry is not
 * a generic warning — it is the bug that took this project days to diagnose in
 * production, and the reason it is marked "breaks selling" and not "advanced".
 *
 * Nothing in this file blocks anything. It produces text. The page never
 * refuses to deploy, the source is editable by hand, and anyone who wants to
 * skip the advice can copy the contract out and deploy it themselves. The
 * warnings exist so a choice is informed, not so it is prevented.
 *
 * `level` drives the colour and the buyer-facing summary:
 *   safe     nothing here lets the owner touch anyone else's tokens
 *   caution  changes behaviour in ways an integrator has to know about
 *   danger   the owner can take value from, or trap, a holder
 *   fatal    the token will not trade correctly on this chain at all
 */

export const QUOTE = {
  address: "0x3600000000000000000000000000000000000000",
  symbol: "USDC",
  decimals: 6,
};

/* Verified on-chain 2026-09-02, not taken from documentation.
 * The V3 factory Uniswap documents for chain 5042 does NOT exist on Arc:
 * this deployment is a third-party fork, and it is the one 403 of the last
 * 404 pools were created on. */
export const ARC = {
  chainId: 5042,
  v3Factory: "0xf0db7b58379503491d857dB50AC9ece64c653918",
  positionManager: "0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  /* The position manager reports WETH9() = 0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f,
   * which does not answer name(), symbol() or decimals() — it is a dead address
   * inherited from the fork. On Arc the gas token IS USDC, so there is no
   * wrapping step: never use the payable/refundETH path, always approve
   * 0x3600… as a plain ERC20. */
  weth9Unusable: "0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f",
  deadAddress: "0x000000000000000000000000000000000000dEaD",
};

/* Fee tiers actually enabled on this factory — 0.25% is NOT, despite being
 * standard elsewhere. feeAmountTickSpacing() returned 0 for it. */
export const FEE_TIERS = [
  { fee: 100, tickSpacing: 1, label: "0.01%", hint: "Stable pairs. Almost no room for price to move." },
  { fee: 500, tickSpacing: 10, label: "0.05%", hint: "Correlated assets." },
  { fee: 3000, tickSpacing: 60, label: "0.30%", hint: "The usual choice for a normal token." },
  { fee: 10000, tickSpacing: 200, label: "1.00%", hint: "Volatile or brand-new tokens. Every pool on this site uses this one." },
];

export const FEATURES = [
  {
    id: "burnable",
    name: "Burnable",
    level: "safe",
    what: "Anyone can permanently destroy tokens they already hold.",
    why: "Lets you and your holders reduce supply on purpose. Buyback-and-burn is built on this.",
    risk: "Nothing. A holder can only burn their own balance — you cannot burn someone else's.",
    buyerSees: "No new power for you over anyone's tokens.",
  },
  {
    id: "permit",
    name: "Gasless approvals (EIP-2612)",
    level: "safe",
    what: "Adds permit(), so an approval can be given by signing a message instead of sending a transaction.",
    why: "Cheaper for holders and required by some routers and aggregators.",
    risk: "Effectively none, and it is a well-audited standard. It does add a signature people can be phished into signing — same as a normal approval, no worse.",
    buyerSees: "A standard convenience. Neutral.",
  },
  {
    id: "capped",
    name: "Hard supply cap",
    level: "safe",
    needs: ["mintable"],
    what: "Sets a ceiling that total supply can never cross, even with minting on.",
    why: "The honest way to keep minting: you can issue more later, but never past a number written into the contract on day one.",
    risk: "None by itself. It is a limit on a power, not a power.",
    buyerSees: "Turns unlimited minting into a known worst case. Strongly recommended if you enable minting at all.",
  },
  {
    id: "mintable",
    name: "Owner can mint more",
    level: "danger",
    what: "The owner can create new tokens out of nothing, at any time, to any address.",
    why: "Rewards, staking emissions, or a treasury you top up later.",
    risk: "This is the most common way a token is drained. You can print supply and sell it into the pool until the pool is empty. Every holder is diluted with no warning and no vote.",
    buyerSees: "A red flag unless the ownership is renounced or a hard cap is set. Most buyers check for exactly this.",
  },
  {
    id: "pausable",
    name: "Owner can pause all transfers",
    level: "danger",
    what: "A switch that freezes every transfer of the token, for everyone, until the owner unfreezes it.",
    why: "Sometimes used as an emergency stop during an exploit.",
    risk: "While paused nobody can sell — not your holders, not the pool, not you. It is a honeypot with an off switch, and the contract cannot tell an emergency apart from an exit.",
    buyerSees: "A serious red flag. It means their ability to sell depends on you staying willing.",
  },
  {
    id: "blacklist",
    name: "Owner can block addresses",
    level: "danger",
    what: "The owner keeps a list of addresses that are not allowed to send or receive the token.",
    why: "Usually pitched as blocking bots or sanctioned wallets.",
    risk: "You can freeze exactly the wallets that try to sell, one at a time, while the chart keeps moving normally for everyone else. That makes it harder to spot than a pause, not safer.",
    buyerSees: "A serious red flag, and the one that most often shows up after the fact.",
  },
  {
    id: "tradingToggle",
    name: "Trading starts disabled",
    level: "danger",
    what: "Transfers are blocked for everyone except the owner until the owner turns trading on, once.",
    why: "Stops snipers buying in the same block the pool is created.",
    risk: "Until you flip it, nobody who buys can sell. If you never flip it, they never can. The contract has no way to force you.",
    buyerSees: "Tolerable only if it is already on. Check the switch, not the promise.",
  },
  {
    id: "maxTx",
    name: "Max transaction / max wallet",
    level: "danger",
    what: "Caps how many tokens can move in one transfer, or how many one address may hold.",
    why: "Anti-whale and anti-sniper measures at launch.",
    risk: "Set low enough, it makes selling impossible without saying so — a sale just reverts. It also breaks pool operations and can strand liquidity, because the pool itself is an address that holds a lot.",
    buyerSees: "Needs the actual numbers checked. A 0.1% max wallet on a small supply is a trap.",
  },
  {
    id: "transferTax",
    name: "Tax on every transfer",
    level: "fatal",
    what: "Takes a percentage of every transfer and sends it somewhere — a treasury, the liquidity, a reflection pool.",
    why: "The usual pitch is funding marketing or auto-adding liquidity without a treasury wallet.",
    risk:
      "This one is not a matter of opinion, and we have paid for it. A fee-on-transfer token breaks the normal swap path: the pool receives less than the router calculated, the constant-product check fails and the transaction reverts. In practice buys work and sells do not, which looks like a broken site rather than a broken token. It cost this project days to diagnose on a live token. Worse here: Uniswap V3 and V4 pools do not support fee-on-transfer at all, and every pool on this chain is V3 or V4. There is no fee tier that fixes it.",
    buyerSees: "Most routers and aggregators will simply fail to sell the token. Do not enable this if you want it tradeable here.",
    blocksPool: true,
  },
  {
    id: "upgradeable",
    name: "Upgradeable contract",
    level: "fatal",
    what: "Deploys behind a proxy so the owner can replace the token's entire logic later.",
    why: "Fixing bugs after launch without migrating holders.",
    risk:
      "Every other guarantee on this page stops meaning anything. A token with no mint function today can be given one tomorrow, by you, without asking anyone. Auditing the code a buyer can read tells them nothing about the code that will run.",
    buyerSees: "The strongest red flag there is. Almost no community token has a legitimate reason for it.",
    extraNote: "Turning this on generates two contracts instead of one: the token, and an ERC-1967 proxy that holds the balances and points at it. You deploy both, and the token's address is the proxy's. The admin can point it somewhere else whenever they like \u2014 setting the admin to the zero address later is the only way to make it permanent.",
  },
];

/* Ownership is not a feature you tick — it is the question every dangerous
 * feature above depends on, so it gets its own control. */
export const OWNERSHIP = {
  id: "ownership",
  options: [
    {
      id: "keep",
      name: "Keep ownership",
      level: "caution",
      what: "You keep every owner-only power you enabled above.",
      risk: "Buyers have to trust you personally, and have no way to verify that trust on-chain.",
    },
    {
      id: "renounce",
      name: "Renounce at deploy",
      level: "safe",
      what: "Ownership is dropped inside the deploy transaction, so no owner-only function can ever be called.",
      risk: "Permanent and irreversible. If you enabled minting or a trading toggle, renouncing kills them too — including the trading toggle, which would leave trading off forever. The builder blocks that combination.",
    },
  ],
};

/* Range presets for adding liquidity. The last three are the reason this page
 * exists: almost nobody realises a V3 range placed entirely on one side of the
 * price needs only ONE of the two tokens, and behaves like a standing order
 * rather than a market. */
export const RANGE_PRESETS = [
  {
    id: "full",
    name: "Full range",
    what: "From the lowest tick to the highest. Your liquidity is active at every possible price.",
    like: "Behaves like an old V2 pool: always quoting, never out of range.",
    needs: "Both tokens, in whatever ratio the current price implies.",
  },
  {
    id: "band",
    name: "Concentrated band",
    what: "Active only between a minimum and a maximum price you pick.",
    like: "Far more depth for the same money inside the band, and nothing at all outside it. Earns more while the price stays put; earns zero the moment it leaves.",
    needs: "Both tokens while the price sits inside the band.",
  },
  {
    id: "sell",
    name: "Sell wall (one-sided, above the price)",
    what: "The whole range sits ABOVE the current price, so it holds only your token.",
    like: "A standing sell order spread across a price range. As the price rises into it, your tokens are sold for USDC, bit by bit. No USDC needed to open it.",
    needs: "Only your token.",
  },
  {
    id: "buy",
    name: "Buy wall (one-sided, below the price)",
    what: "The whole range sits BELOW the current price, so it holds only USDC.",
    like: "A standing bid. If the price falls into it you end up buying, gradually, at prices you chose in advance.",
    needs: "Only USDC.",
  },
  {
    id: "single",
    name: "Single tick",
    what: "One tick wide \u2014 the narrowest position the pool allows.",
    like: "Enormous depth at exactly one price and none anywhere else. Almost a limit order. It goes out of range on the first trade that moves the price.",
    needs: "Whichever side the tick sits on.",
  },
  {
    id: "manual",
    name: "Raw ticks",
    what: "Type the two tick numbers yourself. No conversion, no rounding help beyond the tick spacing.",
    like: "For trying things this list does not cover. Nothing is checked for you.",
    needs: "Depends entirely on where you put them.",
  },
];

export function featureById(id) {
  return FEATURES.find((f) => f.id === id) || null;
}

/* Conflicts the builder refuses to deploy, rather than warn about. Each one
 * produces a token that is provably broken, not merely risky. */
export function conflictsFor(state) {
  const out = [];
  if (state.ownership === "renounce" && state.tradingToggle) {
    out.push({
      id: "renounce-vs-trading",
      text: "Trading starts disabled and ownership is renounced at deploy. Nobody could ever turn trading on — the token would be permanently frozen from block one.",
    });
  }
  if (state.capped && !state.mintable) {
    out.push({
      id: "cap-without-mint",
      text: "A supply cap only means something when minting is on. With a fixed supply the cap is already the supply, so this generates a variable nothing reads.",
    });
  }
  if (state.upgradeable) {
    out.push({
      id: "proxy-beats-everything",
      text: "With the proxy on, every other line on this page describes the code running today, not the code that will run tomorrow. The admin can replace the implementation with anything and keep all the balances. A renounced owner does not help: the owner and the proxy admin are different keys.",
    });
  }
  if (state.transferTax) {
    const bps = Number(state.taxBps) || 0;
    if (bps > 0) {
      out.push({
        id: "tax-vs-v3",
        text:
          "The tax is set to " + (bps / 100) + "%, so swaps through a Uniswap V3 pool will revert \u2014 the pool receives less than the router calculated and the maths refuses. Buying and selling through any normal router will fail. If that is the point, carry on; if it is not, set the tax to 0.",
        fatal: true,
      });
    } else if (state.ownership !== "renounce") {
      out.push({
        id: "tax-armed",
        text:
          "The tax is 0% today, so the token trades normally \u2014 but the function to raise it is in the contract and you keep the key to it. The day you set it above zero, every pool on this chain stops being able to sell it. A buyer reading the code sees a switch you can flip, not a promise you made.",
      });
    }
  }
  return out;
}

/* What a buyer would conclude, in one line, from the switches as they stand.
 * Shown live while the launcher is still deciding — the whole point is that
 * they see it before they deploy, not after someone posts it on X. */
export function verdict(state) {
  const on = FEATURES.filter((f) => state[f.id]);
  /* A feature is only fatal if it is actually armed. A tax switch sitting at 0%
   * does not break trading today \u2014 it is a danger, because the owner can arm
   * it, not a defect. Saying "will not trade" about a token that trades fine
   * would train people to ignore the banner. */
  const fatal = on.filter((f) =>
    f.level !== "fatal" ? false
      : f.id === "transferTax" ? Number(state.taxBps) > 0
      /* A proxy does not stop the token trading -- it trades perfectly. What it
       * breaks is every guarantee, and that gets its own verdict above. */
      : f.id === "upgradeable" ? false
      : true);
  const armedTax = state.transferTax && Number(state.taxBps) === 0 && state.ownership !== "renounce";
  const danger = on.filter((f) => f.level === "danger");

  if (state.upgradeable) {
    return {
      level: "fatal",
      headline: "Everything below can be replaced later",
      detail: "The proxy admin can swap the implementation for any other contract while keeping every balance. Nothing else on this page is a guarantee while that is on.",
    };
  }
  if (fatal.length) {
    return {
      level: "fatal",
      headline: "This token will not trade properly",
      detail: fatal.map((f) => f.name).join(", ") + " — see the risk note on each.",
    };
  }
  if (armedTax) {
    return {
      level: "danger",
      headline: "It trades today, and you hold the switch that stops it",
      detail: "The transfer tax is at 0%, so nothing is broken right now. Raising it above zero would make the token unsellable in every pool on this chain, and only you can do that.",
    };
  }
  if (danger.length && state.ownership === "renounce") {
    return {
      level: "caution",
      headline: "Powerful switches, but ownership is dropped at deploy",
      detail: "You enabled " + danger.map((f) => f.name.toLowerCase()).join(", ") + ", and then renounced, so none of them can ever be called. Verifiable on-chain.",
    };
  }
  if (danger.length) {
    return {
      level: "danger",
      headline: "You keep powers over other people's tokens",
      detail: danger.map((f) => f.name).join(", ") + ". A buyer can see all of it, and most will check.",
    };
  }
  /* An editable metadata URI is the mildest owner power there is -- it cannot
   * move anyone's balance -- but it IS one, and saying "no owner-only power was
   * enabled" while the contract carries setMetadataURI() is simply false. */
  if (state.metaMutable && state.metaMode && state.metaMode !== "none" && state.ownership !== "renounce") {
    return {
      level: "caution",
      headline: "You can change the picture and the links, and nothing else",
      detail: "No owner function here can touch anyone's balance. The one power you keep is setMetadataURI(), so a buyer is trusting you not to swap the identity later. Renouncing afterwards ends that, and owner() returning the zero address is how anyone checks.",
    };
  }
  return {
    level: "safe",
    headline: "Nothing here lets you touch anyone else's tokens",
    detail: state.ownership === "renounce"
      ? "Fixed behaviour, ownership renounced at deploy."
      : "Ownership is kept, but no owner-only power was enabled.",
  };
}
