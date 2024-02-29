import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {DeployFunction} from 'hardhat-deploy/types';
import dotenv from 'dotenv';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const {deployments, getNamedAccounts} = hre;
  const {deploy} = deployments;
  const environment = process.env.NODE_ENV;
  const envFile = environment === 'production' ? '.env.production' : environment === "test"? '.env.test': '.env.local';
  dotenv.config({ path: envFile });


  const ENERGY_ADDRESS = process.env.ENERGY_ADDRESS

  const {deployer} = await getNamedAccounts();

  await deploy('EnergyEscrow', {
    from: deployer,
    args: [ENERGY_ADDRESS],
    log: true,
  });
};
export default func;
func.tags = ['EnergyEscrow'];
