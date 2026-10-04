// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title Oligarc ($OLIG)
/// @notice The Oligarc token. A fixed supply of 1,000,000,000 OLIG is minted once, at deployment, to the deployer.
///         There is no owner and no admin: nobody can mint more, pause, blacklist, tax or move anyone else's tokens.
///         Holders can burn their own tokens (burn / burnFrom), and approve with a signature (EIP-2612 permit).
///         Trading fees and burns for buys and sells will live in the trading pool's hook, never in this contract.
contract Oligarc is ERC20, ERC20Burnable, ERC20Permit {
    /// @notice The supply minted at deployment: one billion tokens with 18 decimals.
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 ether;

    constructor() ERC20("Oligarc", "OLIG") ERC20Permit("Oligarc") {
        _mint(msg.sender, INITIAL_SUPPLY);
    }
}
