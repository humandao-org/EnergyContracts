import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';

/** 
 * Constants to be configured
*/

//USDC
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDHC_ADDRESS = '0x23e259cFf0404d90FCDA231eDE0c350fb509bDd7';

//USDT
const USDT_ADDRESS = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const USDHT_ADDRESS = '0x753e0F7Fb8556fC274B0699417dfAbB6d6eBf38b';


const BAL_ADDRESS = '0xfa8449189744799ad2ace7e0ebac8bb7575eff47';
const HDAO_ADDRESS = '0x10e6f5debFd4A66A1C1dDa6Ba68CfAfcC879eab2';
const ENERGY_ADDRESS = '0xfFc49340f8dbB699f0677e6Fa9f31d9ab7292Fac';

const MAX_MINT_AMOUNT = BigInt("300000");

/**
 * @constant {{address: string, amount:number, poolAddress:string}[]}
 */
const FIXED_EXCHANGE_RATES = [
    { address: USDHC_ADDRESS, amount: 25 * 10 ** 5, pool:'0xefed1e8b816e245847230368c302dd97791a5964000200000000000000000940'},
    { address: USDHT_ADDRESS, amount: 25 * 10 ** 5, pool:'0x4209bcfcc4faf674c49564869507e7835844036b00020000000000000000095f'},
];
const DYNAMIC_EXCHANGE_TOKENS = [
    { address: HDAO_ADDRESS, pool: '0x34eb7a37aabcb12a68531338a742b964d4445506000200000000000000000942' },
    { address: BAL_ADDRESS, pool: '0x9ca319ec0cfd8a40e865f955f91ca7224be2135400020000000000000000091d' },
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
