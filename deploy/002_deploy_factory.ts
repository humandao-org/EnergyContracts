import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import dotenv from 'dotenv';


// Load environment variables based on the NODE_ENV value
const environment = process.env.NODE_ENV;
const envFile = environment === 'production' ? '.env.production' : environment === "test"? '.env.test': '.env.local';
dotenv.config({ path: envFile });

//Needed parameters

const ENERGY_ADDRESS = process.env.ENERGY_ADDRESS
const RECIPIENT_ADDRESS = process.env.RECIPIENT_ADDRESS
const MAX_MINT_AMOUNT = BigInt("300000");


//Pool will be ETH/Stablecoin
//Remove usdt for the meantime as we don't have any stable pool that can support usdt/weth swapping unlike usdc.
const FIXED_EXCHANGE_RATES = [
    // { address: process.env.USDT_ADDRESS, amount: 25 * 10 ** 5, pool:process.env.USDT_POOL},
    { address: process.env.USDC_ADDRESS, amount: 25 * 10 ** 5, pool:process.env.USDC_POOL},
    //Add USDC
    // ["0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"]
    
];

//Pool will be ETH/Dynamic coin
const DYNAMIC_EXCHANGE_TOKENS = [
  { address: process.env.HDAO_ADDRESS, pool:process.env.HDAO_POOL},
];

/** 
 * End of configuration constants
 */

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;

  const {deployer} = await getNamedAccounts();

  await deploy('Factory', {
    from: deployer,
    args: [
      deployer, 
      ENERGY_ADDRESS,
      RECIPIENT_ADDRESS,
      MAX_MINT_AMOUNT,
      FIXED_EXCHANGE_RATES.map(a => a.address),
      FIXED_EXCHANGE_RATES.map(a => BigInt(a.amount)),
      DYNAMIC_EXCHANGE_TOKENS.map(a => a.address),
      DYNAMIC_EXCHANGE_TOKENS.map(a => a.pool),
      FIXED_EXCHANGE_RATES.map(a=>a.address),
      FIXED_EXCHANGE_RATES.map(a=>a.pool)
    ],
    log: true,
  });
};
export default func;
func.tags = ['Factory'];
