import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.20",
      }
    ],
  },
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      forking: {
        url: 'https://polygon-mainnet.g.alchemy.com/v2/' + process.env.ALCHEMY_TOKEN,
      },
      accounts: {
        mnemonic: "test guitar strings planets test test test test test test test junk",
        path: "m/44'/60'/0'/0",
        initialIndex: 0,
        count: 20,
        passphrase: "",
      },
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY
  }
};

export default config;
