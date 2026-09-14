/* RUTAS — el motor de rutas de compra y venta contra USDC en Arc (5042).
   ===========================================================================
   Un solo fichero, sin dependencias, ES2019. No importa ethers: lo RECIBE,
   porque cada pagina que lo usa ya trae el suyo (y alguna lo carga tarde).
   En navegador queda en `window.Rutas`; en Node, module.exports.

   Que hace, en el orden en que se usa:
     1. descubrirRutas  pools de la moneda + mapa de puentes -> rutas desde USDC,
                        con CADA pool validada en cadena (factoria V3 getPool,
                        factoria V2 getPair, o el hash de la PoolKey V4).
     2. cotizar         QuoterV2 para tramos V3, V4Quoter para tramos V4, reservas
                        para V2; una ruta mixta se cotiza tramo a tramo.
     3. guardaPerdida   la guarda del 35%: la salida neta contra el precio spot
                        de las mismas pools (y contra un precio USD si se da).
     4. aprobaciones    ERC-20 approve a Permit2 y Permit2.approve al router, por
                        el importe EXACTO y con caducidad corta.
     5. construirSwap   calldata de UniversalRouter.execute con la comision del 1%.
     6. preflight       eth_call del calldata exacto desde la direccion del usuario.

   EL ROUTER DESPLEGADO ES EL 2.1.x, NO EL 2.0.0, y eso cambia los bytes.
   Comprobado en su bytecode (0x4fca...9fb1): estan executeSigned, depositV3
   de Across y los errores por salto (V3TooLittleReceivedPerHop,
   V4TooLittleReceivedPerHopSingle, InvalidHopPriceLength), y NO esta nada del
   2.2.0 (verifiedPermissionsAdapterOf, SwappingDisabled). Consecuencias:
     - V3_SWAP_EXACT_IN lleva un SEXTO campo, uint256[] minHopPriceX36.
     - Los structs de V4 llevan minHopPriceX36 (ExactInputSingleParams entre
       amountOutMinimum y hookData; ExactInputParams entre path y amountIn).
   Aqui va vacio / cero: la proteccion es el SWEEP final con minSalida.

   Y DOS COSAS DE ARC QUE NO SON UNISWAP:
     - WETH9 y la factoria V2 del router apuntan a UnsupportedProtocol
       (0x8bce...937f, revierte todo con 0xea3559ef). WRAP_ETH, UNWRAP_WETH y
       V2_SWAP_* no sirven. El nativo se paga con SETTLE nativo de V4 (msg.value)
       y las pools V2 siguen por su router de siempre: aqui solo se cotizan.
     - El USDC nativo (18 dec) y el ERC-20 0x3600... (6 dec) son EL MISMO saldo.
       Por eso el router puede gastar como ERC-20 lo que le llega por msg.value
       (modoPago 'valor'), y por eso la comision en nativo ES USDC. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Rutas = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── DIRECCIONES (Arc mainnet 5042), verificadas en cadena el 14-sep ── */
  var DIRECCIONES = {
    USDC: '0x3600000000000000000000000000000000000000',
    NATIVO: '0x0000000000000000000000000000000000000000',
    UNIVERSAL_ROUTER: '0x4fca4a51ab4f23a7447b3284fbd7d73289a89fb1',
    PERMIT2: '0x000000000022d473030f116ddee9f6b43ac78ba3',
    V3_FACTORY: '0xf0db7b58379503491d857db50ac9ece64c653918',
    V3_QUOTER_V2: '0x7dfd4f31be6814d2906bde155c3e1b146eac1468',
    V4_QUOTER: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
    V4_STATE_VIEW: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',
    V4_POOL_MANAGER: '0x8366a39cc670b4001a1121b8f6a443a643e40951'
  };

  /* LA CARTERA DE LA PLATAFORMA. Una sola constante para todas las rutas:
     "1% todas compras y ventas", tambien en multi-salto. */
  var CARTERA_COMISION = '0xb39924ffb4fceb6f080e0f2d7260a08c8e467276';
  var COMISION_BIPS = 100;

  /* ── HOOKS DE V4: SOLO LOS QUE SE PUEDEN PROBAR EN CADENA (14-sep) ──
     Un hook es codigo de un tercero que corre DENTRO de cada swap: puede cobrar
     lo que quiera o quedarse la salida. Con politicaHooks 'arguspad' el motor
     solo acepta pools sin hook o con un hook que se DEMUESTRA de Arguspad
     Portal #6. Cualquier otro se descarta con su motivo.

     LA PRUEBA, y cada eslabon se lee de la cadena en cada sesion:
       1. los 14 bits bajos de la direccion del hook valen 0x2044
          (beforeInitialize | afterSwap | afterSwapReturnsDelta: el impuesto
          sale de la SALIDA del swap). Es lo que exige el Portal al minarlo.
       2. hook.portal() es el Portal #6.
       3. hook.token() es una de las dos monedas de la pool, y hook.poolId()
          es el id de ESTA PoolKey.
       4. Y EL ESLABON QUE NO SE PUEDE FALSIFICAR: Portal6.launches(token)
          devuelve el hook en su palabra 4 (y el splitter en la 5, igual a
          hook.splitter(), y la moneda de cotizacion en la 10). Los tres
          primeros los puede imitar cualquiera desplegando un contrato; el
          registro del Portal solo lo escribe el Portal al lanzar.
     Medido el 14-sep:
       ARCX10 0x12ce...5434  hook 0x462b...e044  portal() = Portal #6,
         token() = ARCX10, poolId() = 0x7780...2a64 (el poolAddress de la API),
         launches(ARCX10) = [creador 0x140d...0f24, .., .., 0xb2d7...f553,
         HOOK, splitter 0x2d50...4edf, 500, 500, .., .., USDC 0x3600]; y
         buyTaxBps() = sellTaxBps() = 500. Misma forma en ARGOS (100/100) y
         BUILDERS (300/300).
       ARK 0xb102...3f89 y POTATO 0x333a...1ed7 llevan un hook con esos mismos
         getters pero portal() = 0xa36c443a797771df82533b8b4a86f0affd970862, y
         Portal #6 devuelve launches() vacio para ellas: SE RECHAZAN. Si ese
         otro Portal se confirma de Arguspad, se anade abajo en una linea.
       0x5504...2044 (HI, R1, B1) y 0xd53f...4044 (HIMOTHY) revierten en todos
         los getters: SE RECHAZAN. */
  var PORTALES_ARGUSPAD = ['0xa5628a11c412596e1f63b75a2c0284f843c549d6'];
  var FLAGS_ARGUSPAD = 0x2044;

  /* Factorias V2 conocidas y su comision REAL, medida y no supuesta: WarpDex
     cobra el 1%, no el 0,3% de Uniswap (reservas contra getAmountsOut del
     router 0xd242...47ae el 14-sep: cuadra con 990/1000 al wei). */
  var FACTORIAS_V2 = {
    '0x32330c2400a6e0830d56661169ebb6c147e3577a': { nombre: 'warpdex', feeBps: 100 }
  };

  /* Puentes de long.supply. Solo pools V3 comprobadas con getPool de la
     factoria: CRCL/USDC, LONG/CRCL y NVDA/USDC, las tres al 1%. */
  var PUENTES_LONG_SUPPLY = {
    '0x2ba0f44bdfc17fba30eda9cdbecb908ca45b043b': [{
      version: 'v3', address: '0x2e8180fa3967caf9abf57bbaeab9ae9063bcd7ba',
      token0: '0x2ba0f44bdfc17fba30eda9cdbecb908ca45b043b', token1: '0x3600000000000000000000000000000000000000', fee: 10000
    }],
    '0x2164bb17a2d38c1b5170e987b2c0416df1efc752': [{
      version: 'v3', address: '0x4f1930bf327337208b49fdd4e7b5bdf3bd83029c',
      token0: '0x2164bb17a2d38c1b5170e987b2c0416df1efc752', token1: '0x2ba0f44bdfc17fba30eda9cdbecb908ca45b043b', fee: 10000
    }],
    '0x6505506540dc99f7366316b10e9cf1a584cbd42a': [{
      version: 'v3', address: '0x4268ad801dc449b12341add14d61119d470959f0',
      token0: '0x3600000000000000000000000000000000000000', token1: '0x6505506540dc99f7366316b10e9cf1a584cbd42a', fee: 10000
    }]
  };

  /* ── LOS BYTES DEL ROUTER ─────────────────────────────────────────────
     Commands.sol y Actions.sol de las versiones desplegadas (UR 2.1.x con
     v4-periphery 3231810). ActionConstants es igual en todas. */
  var COMANDOS = {
    V3_SWAP_EXACT_IN: 0x00, PERMIT2_TRANSFER_FROM: 0x02, SWEEP: 0x04, TRANSFER: 0x05,
    PAY_PORTION: 0x06, V2_SWAP_EXACT_IN: 0x08, WRAP_ETH: 0x0b, UNWRAP_WETH: 0x0c, V4_SWAP: 0x10
  };
  var ACCIONES = {
    SWAP_EXACT_IN_SINGLE: 0x06, SWAP_EXACT_IN: 0x07, SETTLE: 0x0b, SETTLE_ALL: 0x0c, TAKE: 0x0e, TAKE_ALL: 0x0f
  };
  var CONSTANTES = {
    MSG_SENDER: '0x0000000000000000000000000000000000000001',
    ADDRESS_THIS: '0x0000000000000000000000000000000000000002',
    CONTRACT_BALANCE: '0x8000000000000000000000000000000000000000000000000000000000000000',
    OPEN_DELTA: 0
  };

  /* ES2019 no tiene literales 0n: todo BigInt sale de aqui. */
  function B(x) { return BigInt(x); }
  var CERO = B(0);
  var DIEZ_MIL = B(10000);
  var UN_E12 = B('1000000000000');
  var Q192 = B(2) ** B(192);

  var ABI = {
    execute: 'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
    getPool: 'function getPool(address,address,uint24) view returns (address)',
    slot0V3: 'function slot0() view returns (uint160 sqrtPriceX96, int24 tick)',
    liquidez: 'function liquidity() view returns (uint128)',
    quoteV3: 'function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
    quoteV4: 'function quoteExactInput((address exactCurrency, (address intermediateCurrency, uint24 fee, int24 tickSpacing, address hooks, bytes hookData)[] path, uint128 exactAmount) params) returns (uint256 amountOut, uint256 gasEstimate)',
    slot0V4: 'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
    liquidezV4: 'function getLiquidity(bytes32 poolId) view returns (uint128)',
    reservas: 'function getReserves() view returns (uint112, uint112, uint32)',
    factoria: 'function factory() view returns (address)',
    token0: 'function token0() view returns (address)',
    getPair: 'function getPair(address,address) view returns (address)',
    allowance: 'function allowance(address,address) view returns (uint256)',
    approve: 'function approve(address,uint256) returns (bool)',
    p2allowance: 'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
    p2approve: 'function approve(address token, address spender, uint160 amount, uint48 expiration)',
    hookPortal: 'function portal() view returns (address)',
    hookToken: 'function token() view returns (address)',
    hookPoolId: 'function poolId() view returns (bytes32)',
    hookSplitter: 'function splitter() view returns (address)',
    hookBuyTax: 'function buyTaxBps() view returns (uint256)',
    hookSellTax: 'function sellTaxBps() view returns (uint256)',
    hookSnipe: 'function currentSnipeTaxBps() view returns (uint256)',
    // Once palabras estaticas; solo se usan la 4 (hook), la 5 (splitter) y la 10 (quote).
    portalLaunches: 'function launches(address) view returns (bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,bytes32)'
  };

  /* Errores que puede devolver una operacion, para decir POR QUE fallo en vez
     de "execution reverted". Router, Permit2, v4-core y pools. */
  var ERRORES = [
    'Error(string)', 'Panic(uint256)', 'ExecutionFailed(uint256,bytes)', 'V3TooLittleReceived()',
    'V3InvalidSwap()', 'V3InvalidCaller()', 'V3TooMuchRequested()', 'V4TooLittleReceived(uint256,uint256)',
    'V4TooMuchRequested(uint256,uint256)', 'InsufficientToken()', 'InsufficientETH()', 'InvalidBips()',
    'TransactionDeadlinePassed()', 'InvalidEthSender()', 'InvalidCommandType(uint256)', 'ContractLocked()',
    'LengthMismatch()', 'SliceOutOfBounds()', 'DeltaNotPositive(address)', 'DeltaNotNegative(address)',
    'UnsupportedProtocolError()', 'AllowanceExpired(uint256)', 'InsufficientAllowance(uint256)',
    'CurrencyNotSettled()', 'PoolNotInitialized()', 'WrappedError(address,bytes4,bytes,bytes)',
    'V2TooLittleReceived()', 'V2InvalidPath()', 'UnsafeCast()', 'NotEnoughLiquidity(bytes32)',
    'InvalidHopPriceLength()', 'V3HopPriceAndPathLengthMismatch()',
    // Solady: monedas que dan a Permit2 permiso infinito de fabrica (BARC). Su
    // approve(Permit2) revierte; por eso aprobaciones() lee antes de pedir.
    'Permit2AllowanceIsFixedAtInfinity()',
    // V4Quoter: envuelve el revert del swap. El de dentro que se vio el 14-sep
    // en una pool LONG/nativo vaciada: el precio ya esta en el limite.
    'UnexpectedRevertBytes(bytes)', 'PriceLimitAlreadyExceeded(uint160,uint160)'
  ];

  function min(a) { return String(a).toLowerCase(); }
  function esDireccion(a) { return /^0x[0-9a-f]{40}$/.test(min(a)); }
  function esUsdc(a) { a = min(a); return a === DIRECCIONES.USDC || a === DIRECCIONES.NATIVO; }
  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* Un revert NO se reintenta: repetirlo da el mismo revert. Lo demas (503,
     429, un nodo que no contesta) si, dos veces, con espera creciente. */
  function esRevert(e) {
    if (!e) return false;
    if (e.code === 'CALL_EXCEPTION') return true;
    var inner = e.info && e.info.error;
    return !!(inner && (inner.code === 3 || /revert/i.test(String(inner.message || ''))));
  }
  function datosRevert(e) {
    if (!e) return null;
    if (typeof e.data === 'string' && e.data.slice(0, 2) === '0x') return e.data;
    var inner = e.info && e.info.error;
    if (inner && typeof inner.data === 'string') return inner.data;
    if (inner && inner.data && typeof inner.data.data === 'string') return inner.data.data;
    return null;
  }
  function reintentar(fn, intentos) {
    var n = 0;
    var max = intentos || 3;
    function uno() {
      return fn().catch(function (e) {
        n++;
        if (esRevert(e) || n >= max) throw e;
        return esperar(250 * n).then(uno);
      });
    }
    return uno();
  }
  /* Tareas de a `ancho` para no martillear el RPC publico. */
  function enTandas(items, ancho, fn) {
    var salida = new Array(items.length);
    var i = 0;
    function siguiente() {
      if (i >= items.length) return Promise.resolve();
      var lote = items.slice(i, i + ancho).map(function (it, k) {
        var idx = i + k;
        return Promise.resolve().then(function () { return fn(it, idx); }).then(function (v) { salida[idx] = v; });
      });
      i += ancho;
      return Promise.all(lote).then(siguiente);
    }
    return siguiente().then(function () { return salida; });
  }

  /* ── CODIFICADORES PUROS ──────────────────────────────────────────────
     Sin lecturas: dado lo mismo, dan los mismos bytes. Se exportan para
     poder compararlos byte a byte con lo que se simula. */
  function crearCodificadores(ethers) {
    var abi = ethers.AbiCoder.defaultAbiCoder();
    var iRouter = new ethers.Interface([ABI.execute]);
    var TUPLA_V4_EXACT_IN = 'tuple(address,tuple(address,uint24,int24,address,bytes)[],uint256[],uint128,uint128)';
    return {
      rutaV3: function (tokens, fees) {
        var tipos = [];
        var valores = [];
        for (var i = 0; i < tokens.length; i++) {
          tipos.push('address'); valores.push(min(tokens[i]));
          if (i < fees.length) { tipos.push('uint24'); valores.push(fees[i]); }
        }
        return ethers.solidityPacked(tipos, valores);
      },
      poolIdV4: function (k) {
        return ethers.keccak256(abi.encode(['address', 'address', 'uint24', 'int24', 'address'],
          [min(k.currency0), min(k.currency1), k.fee, k.tickSpacing, min(k.hooks)]));
      },
      permit2TransferFrom: function (token, destino, cantidad) {
        return abi.encode(['address', 'address', 'uint160'], [min(token), min(destino), cantidad]);
      },
      payPortion: function (token, destino, bips) {
        return abi.encode(['address', 'address', 'uint256'], [min(token), min(destino), bips]);
      },
      sweep: function (token, destino, minimo) {
        return abi.encode(['address', 'address', 'uint256'], [min(token), min(destino), minimo]);
      },
      // 2.1.x: (recipient, amountIn, amountOutMin, path, payerIsUser, minHopPriceX36[])
      v3ExactIn: function (destino, cantidad, minSalida, ruta, pagaUsuario) {
        return abi.encode(['address', 'uint256', 'uint256', 'bytes', 'bool', 'uint256[]'],
          [min(destino), cantidad, minSalida, ruta, pagaUsuario, []]);
      },
      v4Swap: function (acciones, params) {
        return abi.encode(['bytes', 'bytes[]'], [acciones, params]);
      },
      v4Settle: function (moneda, cantidad, pagaUsuario) {
        return abi.encode(['address', 'uint256', 'bool'], [min(moneda), cantidad, pagaUsuario]);
      },
      v4Take: function (moneda, destino, cantidad) {
        return abi.encode(['address', 'address', 'uint256'], [min(moneda), min(destino), cantidad]);
      },
      // ExactInputParams 3231810: (currencyIn, PathKey[] path, uint256[] minHopPriceX36, amountIn, amountOutMinimum)
      v4ExactIn: function (monedaEntra, pathKeys, cantidad, minSalida) {
        return abi.encode([TUPLA_V4_EXACT_IN], [[min(monedaEntra), pathKeys, [], cantidad, minSalida]]);
      },
      execute: function (comandos, inputs, deadline) {
        return iRouter.encodeFunctionData('execute', [comandos, inputs, deadline]);
      }
    };
  }

  function hexByte(n) { return (n < 16 ? '0' : '') + n.toString(16); }

  /* ── EL MOTOR ─────────────────────────────────────────────────────────── */
  function crearMotor(ethers, provider, opciones) {
    if (!ethers || !ethers.AbiCoder) throw new Error('Rutas needs an ethers v6 instance.');
    if (!provider || typeof provider.call !== 'function') throw new Error('Rutas needs a provider with call().');
    var op = opciones || {};
    var dir = Object.assign({}, DIRECCIONES, op.direcciones || {});
    Object.keys(dir).forEach(function (k) { dir[k] = min(dir[k]); });
    var carteraComision = min(op.carteraComision || CARTERA_COMISION);
    var puentesDefecto = op.puentes || PUENTES_LONG_SUPPLY;
    var factoriasV2 = Object.assign({}, FACTORIAS_V2, op.factoriasV2 || {});
    var hooksPermitidos = op.hooksPermitidos ? op.hooksPermitidos.map(min) : null;
    /* null = como hasta hoy (no se mira el hook); 'arguspad' = sin hook o hook
       probado de Arguspad Portal #6 (ver PORTALES_ARGUSPAD). */
    var politicaHooks = op.politicaHooks || null;
    if (politicaHooks !== null && politicaHooks !== 'arguspad') throw new Error('Unknown hook policy: ' + politicaHooks);
    var cod = crearCodificadores(ethers);
    var abi = ethers.AbiCoder.defaultAbiCoder();

    var ifaces = {};
    function iface(clave) {
      if (!ifaces[clave]) ifaces[clave] = new ethers.Interface([ABI[clave]]);
      return ifaces[clave];
    }
    function nombreFn(clave) { return iface(clave).fragments[0].name; }

    /* Lectura por eth_call, con bloque fijado si se pide: la cotizacion y la
       simulacion tienen que ver EL MISMO estado. */
    function leer(to, clave, args, blockTag) {
      var i = iface(clave);
      var data = i.encodeFunctionData(nombreFn(clave), args);
      var tx = { to: to, data: data };
      if (blockTag !== undefined && blockTag !== null) tx.blockTag = blockTag;
      return reintentar(function () { return provider.call(tx); }).then(function (raw) {
        return i.decodeFunctionResult(nombreFn(clave), raw);
      });
    }

    /* ── POOLS ── */
    function normalizarPool(p) {
      if (!p) throw new Error('Empty pool.');
      var v = min(p.version || '');
      if (v !== 'v2' && v !== 'v3' && v !== 'v4') throw new Error('Unknown pool version: ' + p.version);
      var t0 = min(p.token0);
      var t1 = min(p.token1);
      if (!esDireccion(t0) || !esDireccion(t1)) throw new Error('Pool without token0/token1.');
      /* El orden importa: V3 y V4 lo exigen para el hash y V2 para el par.
         Una lista desordenada no se "arregla": se rechaza. */
      if (!(t0 < t1)) throw new Error('Pool tokens are not sorted (token0 must be < token1).');
      var n = { version: v, token0: t0, token1: t1, fee: Number(p.fee) || 0, tickSpacing: null, hooks: null, address: null, id: null, feeBps: null };
      var ref = min(p.address || p.poolAddress || p.id || '');
      if (v === 'v4') {
        if (p.tickSpacing === null || p.tickSpacing === undefined) throw new Error('V4 pool without tickSpacing.');
        n.tickSpacing = Number(p.tickSpacing);
        n.hooks = esDireccion(p.hooks) ? min(p.hooks) : dir.NATIVO;
        n.id = cod.poolIdV4({ currency0: t0, currency1: t1, fee: n.fee, tickSpacing: n.tickSpacing, hooks: n.hooks });
        /* LA POOLKEY TIENE QUE DAR EL ID QUE DICE LA LISTA. Si no, alguien ha
           cambiado un campo (el hook, la comision) y el dinero iria a otra pool. */
        if (/^0x[0-9a-f]{64}$/.test(ref) && ref !== n.id) throw new Error('V4 pool key does not hash to its pool id.');
      } else {
        if (!esDireccion(ref)) throw new Error('Pool without address.');
        n.address = ref;
        if (v === 'v2') n.feeBps = (p.feeBps !== undefined && p.feeBps !== null) ? Number(p.feeBps) : null;
      }
      return n;
    }
    function clavePool(n) { return n.version + ':' + (n.id || n.address); }
    /* LA IDENTIDAD ENTERA, no solo la direccion. Con la direccion sola, una
       lista manipulada que reutilice la direccion de una pool ya validada con
       otras monedas pasaba por la cache sin volver a preguntar a la factoria
       (lo cazo el arnes: "tampered V3 address" no daba error). En V4 el id ya
       es el hash de la clave completa. */
    function claveIdentidad(n) {
      if (n.version === 'v4') return 'v4:' + n.id;
      return n.version + ':' + n.address + ':' + n.token0 + ':' + n.token1 + ':' + n.fee + ':' + n.feeBps;
    }

    /* ── EL HOOK DE ARGUSPAD, PROBADO ── (la prueba entera, arriba de todo)
       Devuelve { ok, motivo, portal, token, splitter, buyTaxBps, sellTaxBps }.
       Un revert en un getter es una respuesta ("no es de Arguspad"); un nodo
       que no contesta NO lo es y se lanza, para no cachear un rechazo falso. */
    function palabraDireccion(w) {
      var h = min(w);
      return /^0x0{24}[0-9a-f]{40}$/.test(h) ? '0x' + h.slice(26) : null;
    }
    function verificarHookArguspad(p, blockTag) {
      var n;
      try { n = p && p.id ? p : normalizarPool(p); } catch (e) { return Promise.reject(e); }
      var h = n.hooks;
      var no = function (motivo) { return { ok: false, motivo: 'V4 pool hook ' + h + ' is not a verified Arguspad hook: ' + motivo + '.' }; };
      if (!h || h === dir.NATIVO) return Promise.resolve({ ok: false, motivo: 'Pool has no hook.' });
      if (Number(B(h) & B(0x3fff)) !== FLAGS_ARGUSPAD) return Promise.resolve(no('its permission bits are not 0x2044'));
      function uno(clave, a, dirLectura) {
        return leer(dirLectura || h, clave, a || [], blockTag).then(function (r) { return { ok: true, v: r }; }, function (e) {
          if (esRevert(e)) return { ok: false };
          throw e;
        });
      }
      return Promise.all([uno('hookPortal'), uno('hookToken'), uno('hookPoolId'), uno('hookSplitter'), uno('hookBuyTax'), uno('hookSellTax')]).then(function (r) {
        if (!r.every(function (x) { return x.ok; })) return no('it does not answer the Arguspad hook getters');
        var portal = min(r[0].v[0]);
        var token = min(r[1].v[0]);
        var splitter = min(r[3].v[0]);
        if (PORTALES_ARGUSPAD.indexOf(portal) < 0) return no('its portal() is ' + portal + ', not Arguspad Portal #6');
        if (token !== n.token0 && token !== n.token1) return no('its token() is not a currency of this pool');
        if (min(r[2].v[0]) !== n.id) return no('its poolId() is not this pool');
        return uno('portalLaunches', [token], portal).then(function (l) {
          if (!l.ok) return no('the Portal does not answer launches()');
          var w = l.v;
          if (palabraDireccion(w[4]) !== h) return no('the Portal does not list this hook for ' + token);
          if (palabraDireccion(w[5]) !== splitter) return no('the Portal lists another splitter');
          var quote = palabraDireccion(w[10]);
          if (quote !== n.token0 && quote !== n.token1) return no('the Portal quote asset is not in this pool');
          return { ok: true, motivo: null, hook: h, portal: portal, token: token, splitter: splitter, quote: quote,
            buyTaxBps: Number(r[4].v[0]), sellTaxBps: Number(r[5].v[0]) };
        });
      });
    }
    /* Los impuestos de ahora mismo, SIN cache: el de francotirador baja del 99%
       a 0 en los 3 primeros segundos de vida de la moneda. */
    function impuestosHook(hook, blockTag) {
      return Promise.all([leer(hook, 'hookBuyTax', [], blockTag), leer(hook, 'hookSellTax', [], blockTag), leer(hook, 'hookSnipe', [], blockTag)])
        .then(function (r) { return { buyTaxBps: Number(r[0][0]), sellTaxBps: Number(r[1][0]), snipeTaxBps: Number(r[2][0]) }; });
    }

    var cacheValidadas = {};
    /* Identidad en cadena. Se cachea: la identidad de una pool no cambia. */
    function validarPool(p, blockTag) {
      var n;
      try { n = normalizarPool(p); } catch (e) { return Promise.reject(e); }
      var k = claveIdentidad(n);
      if (cacheValidadas[k]) return Promise.resolve(cacheValidadas[k]);
      var hecho;
      if (n.version === 'v3') {
        hecho = leer(dir.V3_FACTORY, 'getPool', [n.token0, n.token1, n.fee], blockTag).then(function (r) {
          if (min(r[0]) !== n.address) throw new Error('V3 pool ' + n.address + ' is not the factory pool for its tokens and fee.');
          return leer(n.address, 'slot0V3', [], blockTag);
        }).then(function (s) {
          if (B(s[0]) === CERO) throw new Error('V3 pool ' + n.address + ' is not initialized.');
          return n;
        });
      } else if (n.version === 'v4') {
        if (hooksPermitidos && hooksPermitidos.indexOf(n.hooks) < 0) {
          return Promise.reject(new Error('V4 pool hook ' + n.hooks + ' is not allowed.'));
        }
        var previo = Promise.resolve();
        if (politicaHooks === 'arguspad' && n.hooks !== dir.NATIVO) {
          previo = verificarHookArguspad(n, blockTag).then(function (v) {
            if (!v.ok) throw new Error(v.motivo);
            n.hook = v;
          });
        }
        hecho = previo.then(function () {
          return leer(dir.V4_STATE_VIEW, 'slot0V4', [n.id], blockTag);
        }).then(function (s) {
          if (B(s[0]) === CERO) throw new Error('V4 pool ' + n.id + ' is not initialized.');
          return n;
        });
      } else {
        hecho = leer(n.address, 'factoria', [], blockTag).then(function (r) {
          var f = min(r[0]);
          var conocida = factoriasV2[f];
          if (!conocida) throw new Error('V2 pair ' + n.address + ' comes from an unknown factory.');
          if (n.feeBps === null) n.feeBps = conocida.feeBps;
          n.factory = f;
          return leer(f, 'getPair', [n.token0, n.token1], blockTag);
        }).then(function (r) {
          if (min(r[0]) !== n.address) throw new Error('V2 pair ' + n.address + ' is not the factory pair for its tokens.');
          return leer(n.address, 'token0', [], blockTag);
        }).then(function (r) {
          if (min(r[0]) !== n.token0) throw new Error('V2 pair token0 mismatch.');
          return n;
        });
      }
      return hecho.then(function (ok) { ok.validada = true; cacheValidadas[k] = ok; return ok; });
    }

    /* Busca en la factoria V3 las pools de `token` contra cada moneda de
       `contra`, en los cuatro escalones. Es la forma sin confianza de encontrar
       el LONGCAT de verdad, que no esta en la base del indexer. */
    function buscarPoolsV3(args) {
      var token = min(args.token);
      var contra = (args.contra || [dir.USDC].concat(Object.keys(puentesDefecto))).map(min);
      var fees = args.fees || [100, 500, 3000, 10000];
      var tareas = [];
      contra.forEach(function (c) {
        if (c === token || c === dir.NATIVO) return;
        fees.forEach(function (f) { tareas.push({ c: c, f: f }); });
      });
      return enTandas(tareas, 4, function (t) {
        var t0 = token < t.c ? token : t.c;
        var t1 = token < t.c ? t.c : token;
        return leer(dir.V3_FACTORY, 'getPool', [t0, t1, t.f], args.blockTag).then(function (r) {
          var a = min(r[0]);
          if (a === dir.NATIVO) return null;
          return { version: 'v3', address: a, token0: t0, token1: t1, fee: t.f };
        });
      }).then(function (l) { return l.filter(Boolean); });
    }

    /* ── DESCUBRIMIENTO ──
       Busca hacia atras desde la moneda: cada pool lleva al otro lado; si es
       USDC (ERC-20 o nativo) hay ruta, si es un puente se sigue. Un puente es
       una moneda del mapa, nada mas: las monedas intermedias no salen de la
       lista de pools, que es lo que podria venir manipulado. */
    function descubrirRutas(args) {
      var token = min(args.token);
      var maxSaltos = args.maxSaltos || 3;
      var puentes = args.puentes || puentesDefecto;
      var mapaPuentes = {};
      var todas = {};
      var errores = [];
      function meter(p, origen) {
        var n;
        try { n = normalizarPool(p); } catch (e) { errores.push({ pool: p, origen: origen, error: e.message }); return; }
        todas[claveIdentidad(n)] = n;
      }
      (args.pools || []).forEach(function (p) { meter(p, 'token'); });
      if (Array.isArray(puentes)) {
        puentes.forEach(function (pu) { mapaPuentes[min(pu.token)] = true; (pu.pools || []).forEach(function (p) { meter(p, 'puente'); }); });
      } else {
        Object.keys(puentes).forEach(function (t) { mapaPuentes[min(t)] = true; (puentes[t] || []).forEach(function (p) { meter(p, 'puente'); }); });
      }
      var adyacencia = {};
      Object.keys(todas).forEach(function (k) {
        var n = todas[k];
        (adyacencia[n.token0] = adyacencia[n.token0] || []).push(n);
        (adyacencia[n.token1] = adyacencia[n.token1] || []).push(n);
      });
      var candidatas = [];
      function buscar(actual, saltosAlReves, vistos) {
        (adyacencia[actual] || []).forEach(function (n) {
          var otro = n.token0 === actual ? n.token1 : n.token0;
          if (vistos[otro]) return;
          if (saltosAlReves.some(function (s) { return s.pool === n; })) return;
          var salto = { version: n.version, pool: n, entra: otro, sale: actual };
          var nuevos = saltosAlReves.concat([salto]);
          if (esUsdc(otro)) {
            candidatas.push(nuevos.slice().reverse());
          } else if (mapaPuentes[otro] && nuevos.length < maxSaltos) {
            var v2 = Object.assign({}, vistos); v2[otro] = true;
            buscar(otro, nuevos, v2);
          }
        });
      }
      var inicio = {}; inicio[token] = true;
      buscar(token, [], inicio);

      var usadas = {};
      candidatas.forEach(function (c) { c.forEach(function (s) { usadas[claveIdentidad(s.pool)] = s.pool; }); });
      var claves = Object.keys(usadas);
      return enTandas(claves, 4, function (k) {
        return validarPool(usadas[k], args.blockTag).then(function (v) { return { ok: true, v: v }; },
          function (e) { return { ok: false, error: e.message }; });
      }).then(function (res) {
        var validas = {};
        res.forEach(function (r, i) {
          if (r.ok) validas[claves[i]] = r.v;
          else errores.push({ pool: claves[i], origen: 'cadena', error: r.error });
        });
        var rutas = [];
        candidatas.forEach(function (c) {
          if (!c.every(function (s) { return validas[claveIdentidad(s.pool)]; })) return;
          var saltos = c.map(function (s) { return { version: s.version, pool: validas[claveIdentidad(s.pool)], entra: s.entra, sale: s.sale }; });
          var usdc = saltos[0].entra;
          var conV2 = saltos.some(function (s) { return s.version === 'v2'; });
          rutas.push({
            token: token,
            usdc: usdc,
            nativo: usdc === dir.NATIVO,
            saltos: saltos,
            clave: saltos.map(function (s) { return clavePool(s.pool); }).join('>'),
            conHook: saltos.some(function (s) { return s.pool.hooks && s.pool.hooks !== dir.NATIVO; }),
            ejecutable: !conV2,
            motivo: conV2 ? 'V2 hops cannot run through the UniversalRouter on Arc (its V2 factory is UnsupportedProtocol). Use the existing V2 router path.' : null
          });
        });
        rutas.sort(function (a, b) { return a.saltos.length - b.saltos.length; });
        return { rutas: rutas, descartes: errores };
      });
    }

    /* ── ORIENTACION Y TRAMOS ── */
    function orientar(ruta, lado) {
      if (lado === 'compra') return ruta.saltos.map(function (s) { return { version: s.version, pool: s.pool, entra: s.entra, sale: s.sale }; });
      return ruta.saltos.slice().reverse().map(function (s) { return { version: s.version, pool: s.pool, entra: s.sale, sale: s.entra }; });
    }
    /* Saltos seguidos de V3 van en UN path; de V4, en UN SWAP_EXACT_IN. V2 no
       se agrupa (y no se ejecuta). */
    function tramos(saltos) {
      var out = [];
      saltos.forEach(function (s) {
        var ult = out[out.length - 1];
        if (ult && ult.version === s.version && s.version !== 'v2') ult.saltos.push(s);
        else out.push({ version: s.version, saltos: [s] });
      });
      return out;
    }
    function pathKeysV4(saltos) {
      return saltos.map(function (s) { return [s.sale, s.pool.fee, s.pool.tickSpacing, s.pool.hooks, '0x']; });
    }

    function cotizarTramo(t, cantidad, blockTag) {
      var s0 = t.saltos[0];
      if (t.version === 'v3') {
        var tokens = [s0.entra].concat(t.saltos.map(function (s) { return s.sale; }));
        var ruta = cod.rutaV3(tokens, t.saltos.map(function (s) { return s.pool.fee; }));
        return leer(dir.V3_QUOTER_V2, 'quoteV3', [ruta, cantidad], blockTag).then(function (r) { return B(r[0]); });
      }
      if (t.version === 'v4') {
        return leer(dir.V4_QUOTER, 'quoteV4', [[s0.entra, pathKeysV4(t.saltos), cantidad]], blockTag).then(function (r) { return B(r[0]); });
      }
      return leer(s0.pool.address, 'reservas', [], blockTag).then(function (r) {
        var r0 = B(r[0]); var r1 = B(r[1]);
        var rin = s0.entra === s0.pool.token0 ? r0 : r1;
        var rout = s0.entra === s0.pool.token0 ? r1 : r0;
        var conFee = cantidad * (DIEZ_MIL - B(s0.pool.feeBps));
        return conFee * rout / (rin * DIEZ_MIL + conFee);
      });
    }

    /* Salida a precio spot (sin comisiones de pool ni impacto) de `cantidad`
       por los mismos saltos: la referencia de la guarda del 35%. */
    function spotSalto(s, cantidad, blockTag) {
      var p = s.pool;
      if (p.version === 'v2') {
        return leer(p.address, 'reservas', [], blockTag).then(function (r) {
          var r0 = B(r[0]); var r1 = B(r[1]);
          if (r0 === CERO || r1 === CERO) return CERO;
          return s.entra === p.token0 ? cantidad * r1 / r0 : cantidad * r0 / r1;
        });
      }
      var lectura = p.version === 'v3' ? leer(p.address, 'slot0V3', [], blockTag) : leer(dir.V4_STATE_VIEW, 'slot0V4', [p.id], blockTag);
      return lectura.then(function (r) {
        var sq = B(r[0]);
        if (sq === CERO) return CERO;
        var sq2 = sq * sq;
        return s.entra === p.token0 ? cantidad * sq2 / Q192 : cantidad * Q192 / sq2;
      });
    }
    function spotRuta(saltos, cantidad, blockTag) {
      var p = Promise.resolve(cantidad);
      saltos.forEach(function (s) { p = p.then(function (c) { return spotSalto(s, c, blockTag); }); });
      return p;
    }

    /* ── COTIZAR ──
       compra: `cantidad` es USDC en SEIS decimales, siempre (lo que da la
               pantalla). Ruta nativa -> se sube a 18 y va por msg.value.
               modoPago 'permit2' (por defecto en rutas ERC-20) o 'valor'.
       venta:  `cantidad` en unidades crudas de la moneda. La salida va en las
               unidades de la ruta: 6 dec (ERC-20) o 18 (nativa). */
    function cotizar(args) {
      var ruta = args.ruta;
      var lado = args.lado;
      if (lado !== 'compra' && lado !== 'venta') return Promise.reject(new Error('Side must be compra or venta.'));
      var cantidad = B(args.cantidad);
      if (cantidad <= CERO) return Promise.reject(new Error('Amount must be positive.'));
      var modoPago = ruta.nativo ? 'valor' : (args.modoPago || 'permit2');
      if (modoPago !== 'permit2' && modoPago !== 'valor') return Promise.reject(new Error('Unknown payment mode.'));
      if (lado === 'venta') modoPago = 'permit2';
      var bt = args.blockTag;
      var saltos = orientar(ruta, lado);
      var ts = tramos(saltos);
      var c = {
        lado: lado, ruta: ruta, modoPago: modoPago, cantidad: cantidad, bloque: bt,
        monedaEntrada: saltos[0].entra, monedaSalida: saltos[saltos.length - 1].sale,
        entra: CERO, value: CERO, comision: CERO, monedaComision: null, entraSwap: CERO,
        sale: CERO, saleNeta: CERO, saleSpot: CERO, perdidaBps: 0, tramos: []
      };
      var entradaSpot;
      if (lado === 'compra') {
        if (ruta.nativo || modoPago === 'valor') {
          c.entra = cantidad * UN_E12;
          c.value = c.entra;
          c.comision = c.entra * B(COMISION_BIPS) / DIEZ_MIL;
          c.monedaComision = dir.NATIVO;
          /* En ruta ERC-20 pagada con valor, el router gasta su saldo nativo
             COMO ERC-20: lo que ve balanceOf es el suelo de /1e12. */
          c.entraSwap = ruta.nativo ? c.entra - c.comision : (c.entra - c.comision) / UN_E12;
          entradaSpot = ruta.nativo ? c.entra : cantidad;
        } else {
          c.entra = cantidad;
          c.comision = cantidad * B(COMISION_BIPS) / DIEZ_MIL;
          c.monedaComision = dir.USDC;
          c.entraSwap = cantidad - c.comision;
          entradaSpot = cantidad;
        }
      } else {
        c.entra = cantidad;
        c.entraSwap = cantidad;
        c.monedaComision = ruta.nativo ? dir.NATIVO : dir.USDC;
        entradaSpot = cantidad;
      }
      var p = Promise.resolve(c.entraSwap);
      ts.forEach(function (t) {
        p = p.then(function (x) {
          return cotizarTramo(t, x, bt).then(function (y) {
            c.tramos.push({ version: t.version, saltos: t.saltos.length, entra: x, sale: y });
            return y;
          });
        });
      });
      return p.then(function (sale) {
        if (sale <= CERO) throw new Error('The route quoted zero.');
        c.sale = sale;
        if (lado === 'compra') {
          c.saleNeta = sale;
        } else {
          c.comision = sale * B(COMISION_BIPS) / DIEZ_MIL;
          c.saleNeta = sale - c.comision;
        }
        return spotRuta(saltos, entradaSpot, bt);
      }).then(function (spot) {
        c.saleSpot = spot;
        c.perdidaBps = spot > CERO ? Number((spot - c.saleNeta) * DIEZ_MIL / spot) : 10000;
        return c;
      });
    }

    /* La mejor salida entre varias rutas. Las que no cotizan se devuelven con
       su error, no se esconden. */
    function mejorRuta(args) {
      return enTandas(args.rutas, 2, function (r) {
        return cotizar({ ruta: r, lado: args.lado, cantidad: args.cantidad, blockTag: args.blockTag, modoPago: args.modoPago })
          .then(function (c) { return { ruta: r, cotizacion: c }; }, function (e) {
            return { ruta: r, error: esRevert(e) ? decodificarError(datosRevert(e)) : e.message };
          });
      }).then(function (todas) {
        var mejor = null;
        todas.forEach(function (t) {
          if (!t.cotizacion || !t.ruta.ejecutable) return;
          /* Se compara en USDC de 6 decimales: una venta por ruta nativa sale en 18. */
          var neta = t.cotizacion.saleNeta;
          if (args.lado === 'venta' && t.ruta.nativo) neta = neta / UN_E12;
          if (!mejor || neta > mejor.neta) mejor = { neta: neta, ruta: t.ruta, cotizacion: t.cotizacion };
        });
        return { mejor: mejor ? mejor.cotizacion : null, todas: todas };
      });
    }

    /* ── LA GUARDA DEL 35% ──
       Existe porque el de WARP perdio el 36%. Contra el spot de las MISMAS
       pools, leido de la cadena: no depende del precio del indexer, que para
       LONG da 900k con 6M reales. Si ademas se da un precio USD, se mide
       tambien contra el y manda la peor de las dos. */
    function guardaPerdida(c, opc) {
      var o = opc || {};
      var maxBps = o.maxPerdidaBps === undefined ? 3500 : o.maxPerdidaBps;
      var perdida = c.perdidaBps;
      var fuente = 'spot';
      if (o.precioUsdToken && o.decimalesToken !== undefined) {
        var dec = Number(o.decimalesToken);
        var entraUsd, saleUsd;
        if (c.lado === 'compra') {
          entraUsd = Number(c.cantidad) / 1e6;
          saleUsd = Number(ethers.formatUnits(c.saleNeta, dec)) * Number(o.precioUsdToken);
        } else {
          entraUsd = Number(ethers.formatUnits(c.cantidad, dec)) * Number(o.precioUsdToken);
          saleUsd = Number(ethers.formatUnits(c.saleNeta, c.ruta.nativo ? 18 : 6));
        }
        if (entraUsd > 1) {
          var p2 = Math.round((1 - saleUsd / entraUsd) * 10000);
          if (p2 > perdida) { perdida = p2; fuente = 'usd'; }
        }
      }
      if (perdida > maxBps) {
        throw new Error('Refusing to trade: this size would lose about ' + (perdida / 100).toFixed(1) +
          '% against the market price (' + fuente + '). The pools on this route are too thin for it. Try a smaller amount.');
      }
      return { perdidaBps: perdida, fuente: fuente };
    }

    /* ── CALLDATA ──
       COMPRA: el 1% sale de la ENTRADA antes de tocar ninguna pool.
         permit2: PERMIT2_TRANSFER_FROM(USDC -> router, entra)
                  PAY_PORTION(USDC, cartera, 100)
         nativa / valor: msg.value = entra (18 dec); PAY_PORTION(nativo, cartera, 100)
         tramos con CONTRACT_BALANCE y pagador el router
         SWEEP(moneda, usuario, minSalida)
         (valor en ruta ERC-20: SWEEP(nativo, usuario, 0) devuelve el polvo en wei)
       VENTA: PERMIT2_TRANSFER_FROM(moneda -> router, entra); tramos;
         PAY_PORTION(USDC o nativo, cartera, 100) sobre la SALIDA;
         SWEEP(USDC o nativo, usuario, minSalida).
       Tramo V3: V3_SWAP_EXACT_IN(router, CONTRACT_BALANCE, 0, path, false, []).
       Tramo V4: V4_SWAP[SETTLE(entra, CONTRACT_BALANCE, false),
                         SWAP_EXACT_IN(entra, path, [], OPEN_DELTA, 0),
                         TAKE(sale, router, OPEN_DELTA)]. */
    function construirSwap(args) {
      var c = args.cotizacion;
      if (!c || !c.ruta) throw new Error('construirSwap needs a quote.');
      if (!c.ruta.ejecutable) throw new Error(c.ruta.motivo || 'This route cannot be executed.');
      var slip = args.slippageBps === undefined ? 100 : Number(args.slippageBps);
      if (!(slip >= 0 && slip <= 10000)) throw new Error('Slippage must be between 0 and 10000 bps.');
      var minSalida = (args.minSalida !== undefined && args.minSalida !== null)
        ? B(args.minSalida)
        : c.saleNeta * (DIEZ_MIL - B(slip)) / DIEZ_MIL;
      var deadline = args.deadline !== undefined ? args.deadline : Math.floor(Date.now() / 1000) + 600;
      var cmds = [];
      var ins = [];
      var pasos = [];
      function poner(cmd, input, texto) { cmds.push(cmd); ins.push(input); pasos.push(texto); }
      var saltos = orientar(c.ruta, c.lado);
      var monedaUsdcRuta = c.ruta.nativo ? dir.NATIVO : dir.USDC;

      if (c.lado === 'compra') {
        if (c.modoPago === 'permit2') {
          poner(COMANDOS.PERMIT2_TRANSFER_FROM, cod.permit2TransferFrom(dir.USDC, CONSTANTES.ADDRESS_THIS, c.entra), 'PERMIT2_TRANSFER_FROM USDC');
          poner(COMANDOS.PAY_PORTION, cod.payPortion(dir.USDC, carteraComision, COMISION_BIPS), 'PAY_PORTION USDC 1%');
        } else {
          poner(COMANDOS.PAY_PORTION, cod.payPortion(dir.NATIVO, carteraComision, COMISION_BIPS), 'PAY_PORTION native 1%');
        }
      } else {
        poner(COMANDOS.PERMIT2_TRANSFER_FROM, cod.permit2TransferFrom(c.monedaEntrada, CONSTANTES.ADDRESS_THIS, c.entra), 'PERMIT2_TRANSFER_FROM token');
      }

      tramos(saltos).forEach(function (t) {
        var s0 = t.saltos[0];
        var sN = t.saltos[t.saltos.length - 1];
        if (t.version === 'v3') {
          var tokens = [s0.entra].concat(t.saltos.map(function (s) { return s.sale; }));
          var path = cod.rutaV3(tokens, t.saltos.map(function (s) { return s.pool.fee; }));
          poner(COMANDOS.V3_SWAP_EXACT_IN, cod.v3ExactIn(CONSTANTES.ADDRESS_THIS, CONSTANTES.CONTRACT_BALANCE, 0, path, false), 'V3_SWAP_EXACT_IN x' + t.saltos.length);
        } else if (t.version === 'v4') {
          var acciones = '0x' + hexByte(ACCIONES.SETTLE) + hexByte(ACCIONES.SWAP_EXACT_IN) + hexByte(ACCIONES.TAKE);
          var params = [
            cod.v4Settle(s0.entra, CONSTANTES.CONTRACT_BALANCE, false),
            cod.v4ExactIn(s0.entra, pathKeysV4(t.saltos), CONSTANTES.OPEN_DELTA, 0),
            cod.v4Take(sN.sale, CONSTANTES.ADDRESS_THIS, CONSTANTES.OPEN_DELTA)
          ];
          poner(COMANDOS.V4_SWAP, cod.v4Swap(acciones, params), 'V4_SWAP x' + t.saltos.length);
        } else {
          throw new Error('V2 hop in an executable route.');
        }
      });

      if (c.lado === 'compra') {
        poner(COMANDOS.SWEEP, cod.sweep(c.monedaSalida, CONSTANTES.MSG_SENDER, minSalida), 'SWEEP token minOut');
        if (c.modoPago === 'valor' && !c.ruta.nativo) {
          poner(COMANDOS.SWEEP, cod.sweep(dir.NATIVO, CONSTANTES.MSG_SENDER, 0), 'SWEEP native dust');
        }
      } else {
        poner(COMANDOS.PAY_PORTION, cod.payPortion(monedaUsdcRuta, carteraComision, COMISION_BIPS), 'PAY_PORTION ' + (c.ruta.nativo ? 'native' : 'USDC') + ' 1%');
        poner(COMANDOS.SWEEP, cod.sweep(monedaUsdcRuta, CONSTANTES.MSG_SENDER, minSalida), 'SWEEP ' + (c.ruta.nativo ? 'native' : 'USDC') + ' minOut');
      }

      var comandos = '0x' + cmds.map(hexByte).join('');
      return {
        to: dir.UNIVERSAL_ROUTER,
        data: cod.execute(comandos, ins, deadline),
        value: c.value,
        minSalida: minSalida,
        comandos: comandos,
        inputs: ins,
        pasos: pasos,
        deadline: deadline
      };
    }

    /* ── APROBACIONES ──
       Dos transacciones como mucho, y solo si hacen falta:
         1. ERC-20 approve(Permit2, entra)       -- el importe EXACTO
         2. Permit2.approve(moneda, UR, entra, ahora + expiraSeg)
       Por que acotado: Permit2 y el router son inmutables, pero una aprobacion
       infinita convierte cualquier firma futura (un calldata malo, una web
       suplantada) en acceso a todo el saldo. Con el importe exacto, lo que
       queda despues del swap es cero: PERMIT2_TRANSFER_FROM lo descuenta.
       Por que 30 minutos: la aprobacion y el swap son transacciones distintas
       (con 0 caducaria en el mismo bloque, Permit2 guarda block.timestamp), y
       tienen que cubrir que el usuario confirme en su cartera; si al final no
       firma el swap, lo que sobra muere solo. La nativa no necesita nada. */
    function txAprobacionErc20(token, cantidad) {
      return { to: min(token), data: iface('approve').encodeFunctionData('approve', [dir.PERMIT2, cantidad]), value: CERO, tipo: 'erc20-approve' };
    }
    function txAprobacionPermit2(token, cantidad, expiracion) {
      return {
        to: dir.PERMIT2,
        data: iface('p2approve').encodeFunctionData('approve', [min(token), dir.UNIVERSAL_ROUTER, cantidad, expiracion]),
        value: CERO, tipo: 'permit2-approve'
      };
    }
    function aprobaciones(args) {
      var c = args.cotizacion;
      var usuario = min(args.usuario);
      var expiraSeg = args.expiraSeg || 1800;
      if (c.value > CERO || c.monedaEntrada === dir.NATIVO) return Promise.resolve([]);
      var token = c.monedaEntrada;
      var cantidad = c.entra;
      var ahoraP = args.ahora !== undefined ? Promise.resolve(Number(args.ahora))
        : reintentar(function () { return provider.getBlock(args.blockTag || 'latest'); }).then(function (b) { return Number(b.timestamp); });
      return Promise.all([
        leer(token, 'allowance', [usuario, dir.PERMIT2], args.blockTag),
        leer(dir.PERMIT2, 'p2allowance', [usuario, token, dir.UNIVERSAL_ROUTER], args.blockTag),
        ahoraP
      ]).then(function (r) {
        var txs = [];
        var ahora = r[2];
        if (B(r[0][0]) < cantidad) txs.push(txAprobacionErc20(token, cantidad));
        var p2 = r[1];
        /* Un minuto de margen: una aprobacion que caduca mientras se firma el
           swap es un revert con AllowanceExpired. */
        if (B(p2[0]) < cantidad || Number(p2[1]) < ahora + 60) {
          txs.push(txAprobacionPermit2(token, cantidad, ahora + expiraSeg));
        }
        return txs;
      });
    }

    /* ── ERRORES Y PREFLIGHT ── */
    var tablaErrores = null;
    function decodificarError(data) {
      if (!data || typeof data !== 'string' || data.length < 10) return 'reverted without a reason';
      if (!tablaErrores) {
        tablaErrores = {};
        ERRORES.forEach(function (f) { tablaErrores[ethers.id(f).slice(0, 10)] = f; });
      }
      var sel = data.slice(0, 10).toLowerCase();
      var firma = tablaErrores[sel];
      if (!firma) return 'unknown error ' + sel;
      var tipos = firma.slice(firma.indexOf('(') + 1, -1);
      var nombre = firma.slice(0, firma.indexOf('('));
      if (!tipos) return nombre + '()';
      var args;
      try { args = abi.decode(tipos.split(','), '0x' + data.slice(10)); } catch (e) { return nombre + '(undecodable)'; }
      if (nombre === 'ExecutionFailed') return 'ExecutionFailed(command ' + args[0] + '): ' + decodificarError(args[1]);
      if (nombre === 'WrappedError') return 'WrappedError(hook ' + args[0] + '): ' + decodificarError(args[2]);
      if (nombre === 'UnexpectedRevertBytes') return 'UnexpectedRevertBytes: ' + decodificarError(args[0]);
      return nombre + '(' + args.map(function (a) { return String(a); }).join(', ') + ')';
    }
    /* El calldata EXACTO, desde la direccion del usuario, antes de pedir la
       firma. En V4 un hook puede rechazar por su cuenta; en V3 falta de
       permiso o de saldo. Cuesta una llamada y ahorra una firma perdida. */
    function preflight(args) {
      var tx = { from: min(args.from), to: args.tx.to, data: args.tx.data, value: B(args.tx.value || 0) };
      if (args.blockTag !== undefined) tx.blockTag = args.blockTag;
      return reintentar(function () { return provider.call(tx); }).then(function () { return { ok: true }; }, function (e) {
        if (!esRevert(e)) throw e;
        var d = datosRevert(e);
        return { ok: false, datos: d, error: decodificarError(d) };
      });
    }

    return {
      direcciones: dir,
      carteraComision: carteraComision,
      comisionBips: COMISION_BIPS,
      puentes: puentesDefecto,
      codificadores: cod,
      normalizarPool: normalizarPool,
      validarPool: validarPool,
      verificarHookArguspad: verificarHookArguspad,
      impuestosHook: impuestosHook,
      buscarPoolsV3: buscarPoolsV3,
      descubrirRutas: descubrirRutas,
      cotizar: cotizar,
      mejorRuta: mejorRuta,
      guardaPerdida: guardaPerdida,
      construirSwap: construirSwap,
      aprobaciones: aprobaciones,
      txAprobacionErc20: txAprobacionErc20,
      txAprobacionPermit2: txAprobacionPermit2,
      preflight: preflight,
      decodificarError: decodificarError
    };
  }

  return {
    version: '1.1.0',
    DIRECCIONES: DIRECCIONES,
    PORTALES_ARGUSPAD: PORTALES_ARGUSPAD,
    CARTERA_COMISION: CARTERA_COMISION,
    COMISION_BIPS: COMISION_BIPS,
    COMANDOS: COMANDOS,
    ACCIONES: ACCIONES,
    CONSTANTES: CONSTANTES,
    PUENTES_LONG_SUPPLY: PUENTES_LONG_SUPPLY,
    FACTORIAS_V2: FACTORIAS_V2,
    crearCodificadores: crearCodificadores,
    crearMotor: crearMotor
  };
});
