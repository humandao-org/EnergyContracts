//SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";
import "hardhat/console.sol";

contract UniswapV3Twap {
    constructor() {}

    function estimateAmountOut(address _factory, address _tokenA, address _tokenB, uint24 _fee,  address _tokenOut, uint128 _amount, uint32 _secondsAgo) 
        external 
        view 
        returns (uint amountOut) 
    {
        require(_tokenOut == _tokenA || _tokenOut == _tokenB, "Not a valid tokenOut");

        address _pool = IUniswapV3Factory(_factory).getPool(_tokenA, _tokenB, _fee);
        (int24 _tick, ) = OracleLibrary.consult(_pool, _secondsAgo);

        address _tokenIn = _tokenOut == _tokenA ? _tokenB : _tokenA;

        amountOut = OracleLibrary.getQuoteAtTick(_tick, _amount, _tokenIn, _tokenOut);
    }
}