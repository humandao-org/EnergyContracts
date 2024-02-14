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


// const BAL_ADDRESS = '0xfa8449189744799ad2ace7e0ebac8bb7575eff47';
const FOXT_ADDRESS = '0x3de2E4c495C82A9BE050FB4615fA5223F88c1751'
const HDAO_ADDRESS = '0x10e6f5debFd4A66A1C1dDa6Ba68CfAfcC879eab2';
const ENERGY_ADDRESS = '0xfFc49340f8dbB699f0677e6Fa9f31d9ab7292Fac';
const RECIPIENT_ADDRESS = "0x491afdEd42f1cBAc4E141f3a64aD0C10FA6C209B"

const MAX_MINT_AMOUNT = BigInt("300000");

/**
 * @constant {{address: string, amount:number, poolAddress:string}[]}
 */
const FIXED_EXCHANGE_RATES = [
    { address: USDHC_ADDRESS, amount: 25 * 10 ** 5, pool:'0x20f69a6fe6b518423c6d78845daa36770e5ed3fa000200000000000000000059'},
    { address: USDHT_ADDRESS, amount: 25 * 10 ** 5, pool:'0x72f927ecde1b2168a24d988ecf6fa926d674a01500020000000000000000005a'},
];

//Prod --Uncomment this when deploying to mainnet
// const DYNAMIC_EXCHANGE_TOKENS = [
//     { address: HDAO_ADDRESS, pool: '0x34eb7a37aabcb12a68531338a742b964d4445506000200000000000000000942' },
//     { address: BAL_ADDRESS, pool: '0x9ca319ec0cfd8a40e865f955f91ca7224be2135400020000000000000000091d' },
// ];

//Testing
const DYNAMIC_EXCHANGE_TOKENS = [
  { address: HDAO_ADDRESS, pool: '0xc59df746f926663744ab3d10f9e71dc87a2f94e000020000000000000000005b' },
  { address: FOXT_ADDRESS, pool: '0x8e67c75354f9019bc561a8ba613ee36ccdd6dd3e00020000000000000000005c' },
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
