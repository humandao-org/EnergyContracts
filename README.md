# enrg-contracts

Energy is an ERC20 utility token for the humanDAO project.

Energy can be minted using either an stable exchange (usually stablecoins such as USDC, USDT, ...) or with a dynamic pricing token (HDAO, BAL...).
When minted with dynamic token, the minting price is calculated using the corresponding Balancer Pool, and the SC will exchange the sent tokens for USDC (77%) and HDAO (23%).

Energy can be burned, and get any (available) stablecoin in return (-23%).

## Brief description about the smart contracts structure.
### Energy.sol
ERC20 using Openzepellin's ERC20, ERC20Burnable, ERC20Pausable, Ownable, ERC20Permit.
- 1 decimal
- mint() and burn() methods are only available to the Factory contract.

If no more changes have to be made, owner can be set to '0x...dead'. (This is action can't be reversed)
If no more tokens have to be minted, factoryContract can be set to '0x...dead'

### Factory.sol
All Energy tokens minting and burning is done through this contract.
There's basically 4 actions:
1- Minting Energy with and stable exchange rate (stablecoins)
2- Minting Energy with a dynamic exchange rate (HDAO, BAL...). Price will be determined using an offline price and the corresponding Balancer Pool.
3- Burning Energy and getting a stablecoin of choice in return.
4- Withdrawing any token from the contract to the owner.

Please, take a look at the code comments for more details.

## Installation

```bash
yarn
```

## Testing

```bash
npx hardhat test
```