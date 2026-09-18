/* ===========================================================================
   EL CONTRATO FIJO DEL PASO 6  (18-sep-2026)

   Hasta hoy el paso 6 generaba un contrato NUEVO por token, con el nombre, el
   simbolo y la imagen escritos dentro del codigo. Cada token era un bytecode
   distinto, asi que cada uno habia que verificarlo a mano, y nadie lo hacia:
   en los rastreadores salia "sin verificar", y sin fuente verificada los
   escaneres ni siquiera devuelven si es honeypot o si esta renunciado.

   Ahora la identidad entra por ARGUMENTOS DEL CONSTRUCTOR y vive en storage, y
   el codigo es SIEMPRE EL MISMO. Se verifica una vez, y los exploradores
   emparejan solos cada despliegue posterior con esa fuente (Blockscout lo hace
   con su base de bytecode: asi salen verificados los tokens de openlaunch.lol
   sin que nadie haga nada, medido en PANCHU el 18-sep).

   Dos contratos en la misma fuente, y cada uno es un bytecode fijo. OJO: son DOS
   bytecodes, asi que la verificacion de semilla se hace UNA VEZ POR VARIANTE (el
   primer BaseyToken y el primer BaseyTokenEditable que se lancen), no una en total:
     BaseyToken          owner() es la direccion cero y no hay NINGUNA funcion
                         de dueño. Lo que sale por defecto.
     BaseyTokenEditable  el que despliega puede cambiar la imagen y los enlaces
                         (y solo eso) hasta que llame a renounceOwnership().

   EL COMPILADOR ES EL QUE YA CARGA LA PAGINA (soljson 0.8.24+commit.e11b9ed9,
   optimizador 200, evm paris): el bytecode verificado tiene que poder
   reproducirse con lo que el navegador tiene a mano. Por eso el pragma va FIJO
   y no con ^: con ^ un compilador posterior daria otro bytecode y la
   verificacion de los siguientes dejaria de casar.

   OJO al tocar la fuente: CUALQUIER cambio, un comentario incluido, cambia el
   hash de metadatos del final del bytecode, y los tokens que se lancen despues
   ya no casan con la verificacion de los de antes. Se puede, pero entonces hay
   que verificar el primero de la version nueva. tools/probar-token-fijo.mjs
   guarda la huella del bytecode para que no pase sin darse cuenta.
   =========================================================================== */
import { metadataJSON } from "./solidity.js?v=9";

export const BASEY_TOKEN_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/*
 * The token contract behind every launch from basey.finance.
 *
 * One contract for every token: the identity (name, symbol, supply, picture and
 * links) arrives as constructor arguments and lives in storage, so every token
 * launched here runs exactly the same bytecode, verified once.
 *
 * What anyone can check on chain:
 *   - BaseyToken: owner() is the zero address and there is no owner-only
 *     function. Nothing about the token can be changed by anyone, ever.
 *   - BaseyTokenEditable: the deployer can change the picture and the links,
 *     and nothing else, until they call renounceOwnership().
 *   - Neither can mint, burn someone else's tokens, pause, block, tax or limit
 *     transfers. Those functions do not exist in this file.
 */

abstract contract BaseyERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// The picture, description and links as raw JSON, with the keys
    /// name, symbol, description, image, website, twitter and telegram.
    string public metadataURI;
    /// The picture on its own, and the description on its own: some trackers
    /// read these instead of the JSON.
    string public logo;
    string public description;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    string private constant _TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 wholeSupply,
        string memory metadataJSON,
        string memory logo_,
        string memory description_
    ) {
        require(bytes(name_).length > 0 && bytes(symbol_).length > 0, "name and symbol required");
        require(wholeSupply > 0, "supply must be above zero");
        name = name_;
        symbol = symbol_;
        metadataURI = metadataJSON;
        logo = logo_;
        description = description_;
        totalSupply = wholeSupply * 10 ** decimals;
        balanceOf[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }

    /// The same JSON as metadataURI(), as a base64 data URI, which is the form
    /// the trackers on this chain read. It is built on every read from the one
    /// stored copy, so the two can never disagree.
    function tokenURI() external view returns (string memory) {
        return string.concat("data:application/json;base64,", _base64(bytes(metadataURI)));
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "insufficient allowance");
            unchecked { allowance[from][msg.sender] = allowed - value; }
        }
        _transfer(from, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "transfer to the zero address");
        uint256 bal = balanceOf[from];
        require(bal >= value, "insufficient balance");
        unchecked { balanceOf[from] = bal - value; }
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    /// Standard base64 with padding, written out plainly: it only runs in
    /// views, so clarity is worth more than gas here.
    function _base64(bytes memory data) internal pure returns (string memory) {
        uint256 len = data.length;
        if (len == 0) return "";
        bytes memory table = bytes(_TABLE);
        bytes memory out = new bytes(4 * ((len + 2) / 3));
        uint256 j = 0;
        for (uint256 i = 0; i < len; i += 3) {
            uint256 a = uint8(data[i]);
            uint256 b = i + 1 < len ? uint8(data[i + 1]) : 0;
            uint256 c = i + 2 < len ? uint8(data[i + 2]) : 0;
            uint256 triple = (a << 16) | (b << 8) | c;
            out[j++] = table[(triple >> 18) & 63];
            out[j++] = table[(triple >> 12) & 63];
            out[j++] = i + 1 < len ? table[(triple >> 6) & 63] : bytes1("=");
            out[j++] = i + 2 < len ? table[triple & 63] : bytes1("=");
        }
        return string(out);
    }
}

/// No owner, and there never was one. The getter exists so that anyone, and
/// any tracker, can check it on chain instead of taking it on trust.
contract BaseyToken is BaseyERC20 {
    address public constant owner = address(0);

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 wholeSupply,
        string memory metadataJSON,
        string memory logo_,
        string memory description_
    ) BaseyERC20(name_, symbol_, wholeSupply, metadataJSON, logo_, description_) {}
}

/// The deployer keeps one power: changing the picture, the description and the
/// links. Nothing else. renounceOwnership() gives it up for good.
contract BaseyTokenEditable is BaseyERC20 {
    address public owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event MetadataUpdated(string metadataURI, string logo, string description);

    modifier onlyOwner() {
        require(msg.sender == owner, "not the owner");
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 wholeSupply,
        string memory metadataJSON,
        string memory logo_,
        string memory description_
    ) BaseyERC20(name_, symbol_, wholeSupply, metadataJSON, logo_, description_) {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// One call for the three, so the JSON, the picture and the description can
    /// never point at different things. tokenURI() follows the JSON by itself.
    function setMetadata(string calldata metadataJSON, string calldata logo_, string calldata description_)
        external
        onlyOwner
    {
        metadataURI = metadataJSON;
        logo = logo_;
        description = description_;
        emit MetadataUpdated(metadataJSON, logo_, description_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "use renounceOwnership");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }
}
`;

/* Cual de los dos contratos toca. */
export function contratoDelToken(editable) {
  return editable ? "BaseyTokenEditable" : "BaseyToken";
}

/* Los argumentos del constructor, sacados del plan del paso 6. El JSON lo arma
   solidity.js (metadataJSON), que es el mismo que ya lee nuestro indexer: una
   sola definicion del esquema para las dos rutas. */
export function argsDelToken(plan) {
  const estado = {
    name: plan.nombre, symbol: plan.símbolo,
    metaDescription: plan.descripción, metaImage: plan.imagen,
    metaWebsite: plan.web, metaTwitter: plan.twitter, metaTelegram: plan.telegram,
  };
  const supply = BigInt(Math.floor(Number(plan.supply)));
  const json = metadataJSON(estado);
  /* Lo que va al contrato tiene que ser JSON valido: en un token sin dueño, un JSON
     roto se queda roto para siempre. Mejor parar aqui, antes de pedir la firma. */
  try { JSON.parse(json); } catch (e) { throw new Error("the picture/links JSON is not valid: " + e.message); }
  return [
    String(plan.nombre),
    String(plan.símbolo),
    supply,
    json,
    String(plan.imagen || "").trim(),
    String(plan.descripción || "").trim(),
  ];
}
