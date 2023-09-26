// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6;

abstract contract Oracle {
    function estimateAmountOut(address _tokenOut, uint128 _amount) virtual external view returns (uint amountOut);
}