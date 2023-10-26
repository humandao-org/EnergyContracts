import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';

/** 
 * Constants to be configured
*/
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDT_ADDRESS = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const BAL_ADDRESS = '0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3';
const HDAO_ADDRESS = '0x72928d5436Ff65e57F72D5566dCd3BaEDC649A88';
const ENERGY_ADDRESS = '0x5f48A76306f3f9efbF4B1AdF3a73d0Af1ebfA074';

const MAX_MINT_AMOUNT = BigInt("3000");
const FIXED_EXCHANGE_RATES = [
    { address: USDC_ADDRESS, amount: 4 },
    { address: USDT_ADDRESS, amount: 4 },
];
const DYNAMIC_EXCHANGE_TOKENS = [
    { address: HDAO_ADDRESS, pool: '0xb53f4e2f1e7a1b8b9d09d2f2739ac6753f5ba5cb000200000000000000000137' },
    { address: BAL_ADDRESS, pool: '0x3d468ab2329f296e1b9d8476bb54dd77d8c2320f000200000000000000000426' },
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
      FIXED_EXCHANGE_RATES.map(a => a.amount),
      DYNAMIC_EXCHANGE_TOKENS.map(a => a.address),
      DYNAMIC_EXCHANGE_TOKENS.map(a => a.pool),
    ],
    log: true,
  });
};
export default func;
func.tags = ['Factory'];