// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract Energy is ERC20, ERC20Burnable, ERC20Pausable, Ownable, ERC20Permit {
    address public factory;

    error UnauthorizedFactory();
    error DisabledDefaultBurn();

    event Mint(address indexed _to, uint256 _amount);

    constructor(address _initialOwner, address _factory)
        ERC20("Energy", "ENRG")
        Ownable(_initialOwner)
        ERC20Permit("Energy")
    {
        setFactory(_factory);
    }

    function decimals() public view virtual override returns (uint8) {
        return 2;
    }

    function setFactory(address _factory) 
        public 
        onlyOwner 
    {
        factory = _factory;
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function mint(address _to, uint256 _amount) public {
        if(_msgSender() != factory) revert UnauthorizedFactory();

        _mint(_to, _amount);
        emit Mint(_to, _amount);
    }

    function burn(uint256 value) public virtual override {
        revert DisabledDefaultBurn();
    }

    function burn(address _from, uint256 value) public virtual {
        if(_msgSender() != factory) revert UnauthorizedFactory();

        _burn(_from, value);
    }

    // The following functions are overrides required by Solidity.
    function _update(address _from, address _to, uint256 _value)
        internal
        override(ERC20, ERC20Pausable)
    {
        super._update(_from, _to, _value);
    }
}
