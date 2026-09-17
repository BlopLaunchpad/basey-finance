/* LA COMPRA INICIAL, ATOMICA CON LA POOL.  (17-sep-2026)
 *
 * El dueño: "en vez de suelo pon compra atomica y si no puede ser atomica, lo
 * mas rapido". Puede ser atomica, y esto es como:
 *
 * Un contrato de UN SOLO USO que lo hace todo en su constructor: crea la pool,
 * pone el muro de venta y compra. Una transaccion. No hay un "entre" en el que
 * un sniper pueda comprar antes que quien lanza, porque la pool no existe para
 * nadie hasta que el bloque que la crea ya lleva la compra dentro.
 *
 * POR QUE UN CONSTRUCTOR Y NO UN multicall
 * El multicall del position manager solo puede llamar al position manager: el
 * swap vive en otro contrato (SwapRouter02), asi que no cabe en ese lote. Y dos
 * transacciones seguidas, aunque vayan con nonces consecutivos, dejan que otro
 * se meta en medio ordenando por comision.
 *
 * POR QUE FUNCIONA DENTRO DE UN CONSTRUCTOR
 * Mientras se construye, este contrato no tiene codigo, y nadie puede llamarle
 * de vuelta. No hace falta: el pago de la pool lo piden el position manager y
 * el router con transferFrom sobre NUESTRO saldo (permisos que el constructor
 * si puede dar), y las llamadas de vuelta de la pool van a ELLOS, no aqui.
 *
 * COMO LLEGA EL DINERO
 * El constructor tira de la cartera de quien lo despliega con transferFrom, asi
 * que antes hay que aprobar a la direccion que TENDRA el contrato, que se sabe
 * de antemano (se deriva de la cartera y su nonce). Si el nonce cambia por el
 * camino, el despliegue revierte y no se mueve nada: una aprobacion a una
 * direccion que ya nunca puede tener codigo no la puede gastar nadie.
 *
 * LO QUE COMPRUEBA ANTES DE PONER UN DOLAR
 * Que la pool quede EXACTAMENTE al precio del plan. Si alguien la creo antes a
 * otro precio, createAndInitializePoolIfNecessary no la toca, y sin esta
 * comprobacion el muro y la compra se harian contra el precio de otro.
 *
 * Y NO DEJA NADA DETRAS: el NFT del muro y los tokens comprados van directos a
 * quien lo desplegó, lo que sobre se devuelve, y el contrato no tiene ni una
 * funcion ni un dueño. */

export const COMPRA_ATOMICA_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * One-shot launch. The constructor creates the Uniswap V3 pool, places the
 * sell wall and makes the creator's first buy in the same transaction, so
 * nobody can buy between the pool existing and the creator buying.
 *
 * It keeps nothing: the position NFT and the bought tokens go to whoever
 * deployed it, any leftover is returned, and the contract has no functions
 * and no owner. If any step fails the whole deployment reverts.
 */
interface IERC20Min {
    function balanceOf(address who) external view returns (uint256);
}

interface IPositionManagerMin {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96)
        external
        payable
        returns (address pool);

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

interface IPoolMin {
    function slot0()
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool);
}

/// SwapRouter02 as deployed on Arc: exactInputSingle WITHOUT a deadline field.
interface ISwapRouter02Min {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

contract AtomicLaunch {
    struct Plan {
        address manager;
        address router;
        address token0;
        address token1;
        uint24 fee;
        uint160 sqrtPriceX96;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0;
        uint256 amount1;
        address quote;
        uint256 buyAmount;
        uint256 minOut;
    }

    event Launched(address indexed pool, uint256 indexed tokenId, uint256 usdcSpent, uint256 tokensBought);

    constructor(Plan memory p) {
        address owner = msg.sender;
        require(p.quote == p.token0 || p.quote == p.token1, "quote is not in the pair");
        require(p.buyAmount > 0, "no buy: use the plain batch");
        address token = p.quote == p.token0 ? p.token1 : p.token0;

        // 1. Pull everything first. A wallet that cannot pay stops it here.
        _pull(p.token0, owner, p.amount0 + (p.quote == p.token0 ? p.buyAmount : 0));
        _pull(p.token1, owner, p.amount1 + (p.quote == p.token1 ? p.buyAmount : 0));

        // 2. The pool, and it must sit exactly at the planned price.
        address pool = IPositionManagerMin(p.manager).createAndInitializePoolIfNecessary(
            p.token0, p.token1, p.fee, p.sqrtPriceX96
        );
        (uint160 sqrtNow,,,,,,) = IPoolMin(pool).slot0();
        require(sqrtNow == p.sqrtPriceX96, "pool price is not the planned one");

        // 3. The sell wall, owned by the creator.
        _approve(p.token0, p.manager, p.amount0);
        _approve(p.token1, p.manager, p.amount1);
        (uint256 tokenId,,,) = IPositionManagerMin(p.manager).mint(
            IPositionManagerMin.MintParams({
                token0: p.token0,
                token1: p.token1,
                fee: p.fee,
                tickLower: p.tickLower,
                tickUpper: p.tickUpper,
                amount0Desired: p.amount0,
                amount1Desired: p.amount1,
                amount0Min: 0,
                amount1Min: 0,
                recipient: owner,
                deadline: block.timestamp
            })
        );

        // 4. The first buy, into that wall, in this same transaction.
        _approve(p.quote, p.router, p.buyAmount);
        uint256 bought = ISwapRouter02Min(p.router).exactInputSingle(
            ISwapRouter02Min.ExactInputSingleParams({
                tokenIn: p.quote,
                tokenOut: token,
                fee: p.fee,
                recipient: owner,
                amountIn: p.buyAmount,
                amountOutMinimum: p.minOut,
                sqrtPriceLimitX96: 0
            })
        );

        // 5. Nothing stays here.
        _sendAll(p.token0, owner);
        _sendAll(p.token1, owner);
        emit Launched(pool, tokenId, p.buyAmount, bought);
    }

    function _pull(address t, address from, uint256 amount) private {
        if (amount == 0) return;
        _call(t, abi.encodeWithSelector(0x23b872dd, from, address(this), amount), "transferFrom failed");
    }

    function _approve(address t, address spender, uint256 amount) private {
        if (amount == 0) return;
        _call(t, abi.encodeWithSelector(0x095ea7b3, spender, amount), "approve failed");
    }

    function _sendAll(address t, address to) private {
        uint256 bal = IERC20Min(t).balanceOf(address(this));
        if (bal == 0) return;
        _call(t, abi.encodeWithSelector(0xa9059cbb, to, bal), "transfer failed");
    }

    /// Works with tokens that return true and with tokens that return nothing.
    function _call(address t, bytes memory data, string memory why) private {
        (bool ok, bytes memory ret) = t.call(data);
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), why);
    }
}
`;
