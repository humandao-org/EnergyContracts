// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6;

abstract contract DexTool {
    function estimateAmountOut(address _tokenOut, uint128 _amount) virtual external view returns (uint256 _amountOut);
    function swapExactOutputSingle(uint256 amountOut, uint256 amountInMaximum) virtual external returns (uint256 amountIn);
}