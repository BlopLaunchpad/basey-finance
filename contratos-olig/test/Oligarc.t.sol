// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {Oligarc} from "../src/Oligarc.sol";

contract OligarcTest is Test {
    Oligarc token;
    address deployer = address(0xF8eBF867Ae58179C85B1e158321eFB18c3dad0d5); // la wallet de las comisiones de OligArc
    address alice = address(0xA11CE);
    uint256 bobKey = 0xB0B;
    address bob;

    function setUp() public {
        bob = vm.addr(bobKey);
        vm.prank(deployer);
        token = new Oligarc();
    }

    function testMetadata() public view {
        assertEq(token.name(), "Oligarc");
        assertEq(token.symbol(), "OLIG");
        assertEq(token.decimals(), 18);
    }

    function testSupplyToDeployer() public view {
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.balanceOf(deployer), 1_000_000_000 ether);
        assertEq(token.INITIAL_SUPPLY(), 1_000_000_000 ether);
    }

    function testTransfer() public {
        vm.prank(deployer);
        token.transfer(alice, 123 ether);
        assertEq(token.balanceOf(alice), 123 ether);
        assertEq(token.balanceOf(deployer), 1_000_000_000 ether - 123 ether);
    }

    function testBurnLowersSupply() public {
        vm.prank(deployer);
        token.burn(1_000 ether);
        assertEq(token.totalSupply(), 1_000_000_000 ether - 1_000 ether);
    }

    function testBurnFromNeedsAllowance() public {
        vm.prank(deployer);
        token.transfer(alice, 10 ether);
        vm.expectRevert();
        vm.prank(bob);
        token.burnFrom(alice, 1 ether);
        vm.prank(alice);
        token.approve(bob, 1 ether);
        vm.prank(bob);
        token.burnFrom(alice, 1 ether);
        assertEq(token.balanceOf(alice), 9 ether);
    }

    function testNobodyMovesOthersTokens() public {
        vm.prank(deployer);
        token.transfer(alice, 5 ether);
        vm.expectRevert();
        vm.prank(deployer);
        token.transferFrom(alice, deployer, 1 ether);
    }

    function testPermit() public {
        vm.prank(deployer);
        token.transfer(bob, 50 ether);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(abi.encode(
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
            bob, alice, 20 ether, token.nonces(bob), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(bobKey, digest);
        token.permit(bob, alice, 20 ether, deadline, v, r, s);
        assertEq(token.allowance(bob, alice), 20 ether);
        vm.prank(alice);
        token.transferFrom(bob, alice, 20 ether);
        assertEq(token.balanceOf(alice), 20 ether);
    }

    // sin dueño ni acuñacion: ninguna de esas funciones existe en el contrato
    function testNoAdminSelectors() public {
        bytes4[6] memory sels = [bytes4(keccak256("mint(address,uint256)")), bytes4(keccak256("owner()")), bytes4(keccak256("pause()")),
            bytes4(keccak256("transferOwnership(address)")), bytes4(keccak256("blacklist(address)")), bytes4(keccak256("setFee(uint256)"))];
        for (uint256 i = 0; i < sels.length; i++) {
            (bool ok,) = address(token).call(abi.encodeWithSelector(sels[i], alice, 1));
            assertFalse(ok);
        }
    }
}
