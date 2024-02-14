import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { TransactionRequest, encodeBytes32String } from "ethers";
import { ethers, network } from "hardhat";
import {
  Energy,
  Factory,
  IERC20,
  IERC20Metadata,
  Reentrancy,
} from "../typechain-types";

const BINANCE_WALLET_ADDRESS = "0x388Ea662EF2c223eC0B047D41Bf3c0f362142ad5"; // This might stop working at some point (if they move their funds)
const BINANCE_WALLET_ADDRESS_2 = "0x77693a5D3881dD7F99964219e2827883e66D7E9e"; // This might stop working at some point (if they move their funds)
const HDAO_HOLDER_WALLET_ADDRESS = "0x491afdEd42f1cBAc4E141f3a64aD0C10FA6C209B"; // This might stop working at some point (if they move their funds)
const BAL_HOLDER_WALLET_ADDRESS = "0x7491C6bCf3467973c01253F9176f56a53B680F89"; // This might stop working at some point (if they move their funds)
const USDC_ADDRESS = "0x23e259cFf0404d90FCDA231eDE0c350fb509bDd7";
const WETH_ADDRESS = "0x303d53087ABBbe343e2360BB288275Ddba47A6b6";
const BAL_ADDRESS = "0x3de2E4c495C82A9BE050FB4615fA5223F88c1751";
const HDAO_ADDRESS = "0x10e6f5debFd4A66A1C1dDa6Ba68CfAfcC879eab2";
const USDT_ADDRESS = "0x753e0F7Fb8556fC274B0699417dfAbB6d6eBf38b";

const fixedExchangeRates = [
  {
    address: USDC_ADDRESS,
    amount: 25 * 10 ** 5,
    pool: "0x20f69a6fe6b518423c6d78845daa36770e5ed3fa000200000000000000000059",
  },
  {
    address: USDT_ADDRESS,
    amount: 25 * 10 ** 5,
    pool: "0x72f927ecde1b2168a24d988ecf6fa926d674a01500020000000000000000005a",
  },
];

const dynamicExchangeTokens = [
  {
    address: HDAO_ADDRESS,
    pool: "0xc59df746f926663744ab3d10f9e71dc87a2f94e000020000000000000000005b",
  },
  {
    address: BAL_ADDRESS,
    pool: "0x8e67c75354f9019bc561a8ba613ee36ccdd6dd3e00020000000000000000005c",
  },
];

let energyContract: Energy;
let factoryContract: Factory;
let usdcContract: IERC20Metadata;
let usdtContract: IERC20Metadata;
let wethContract: IERC20Metadata;
let hdaoContract: IERC20Metadata;
let balContract: IERC20Metadata;
let reentrancyContract: Reentrancy;

describe("Energy Factory", async () => {
  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl:
              "https://eth-sepolia.g.alchemy.com/v2/" +
              process.env.ALCHEMY_TOKEN,
          },
        },
      ],
    });
  });

  async function approvePaymentToken(
    amount: bigint,
    paymentToken: IERC20,
    account?: HardhatEthersSigner
  ): Promise<bigint> {
    const exchangeRate = await factoryContract.fixedExchangeRate(
      await paymentToken.getAddress()
    );
    const price = (BigInt(exchangeRate) * amount) / BigInt(10 ** 2);
    if (!account) {
      const [owner] = await ethers.getSigners();
      account = owner;
    }

    await paymentToken
      .connect(account)
      .approve(await factoryContract.getAddress(), price);
    return price;
  }

  async function deployFixture() {
    const [owner, alice, bob, recipient] = await ethers.getSigners();
    usdcContract = await ethers.getContractAt("IERC20Metadata", USDC_ADDRESS);
    usdtContract = await ethers.getContractAt("IERC20Metadata", USDT_ADDRESS);
    wethContract = await ethers.getContractAt("IERC20Metadata", WETH_ADDRESS);
    hdaoContract = await ethers.getContractAt("IERC20Metadata", HDAO_ADDRESS);

    // Deploying Energy Token
    const contractFactory = await ethers.getContractFactory("Energy");
    energyContract = await contractFactory.deploy(owner.address, owner.address);
    await energyContract.waitForDeployment();
    const energyAddress = await energyContract.getAddress();
    expect(energyAddress).to.be.a.properAddress;

    // Deploying Factory
    const minterFactory = await ethers.getContractFactory("Factory");
    factoryContract = await minterFactory.deploy(
      owner.address,
      energyAddress,
      recipient.address,
      BigInt("300000"),
      fixedExchangeRates.map((a) => a.address),
      fixedExchangeRates.map((a) => a.amount),
      dynamicExchangeTokens.map((a) => a.address),
      dynamicExchangeTokens.map((a) => a.pool),
      fixedExchangeRates.map((a) => a.address),
      fixedExchangeRates.map((a) => a.pool)
    );

    // Setting Factory
    await energyContract.setFactory(await factoryContract.getAddress());

    // Get some USDC and USDT from some accounts
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [BINANCE_WALLET_ADDRESS],
    });
    // await network.provider.request({
    //   method: "hardhat_impersonateAccount",
    //   params: [BINANCE_WALLET_ADDRESS_2],
    // });
    // await network.provider.request({
    //   method: "hardhat_impersonateAccount",
    //   params: [HDAO_HOLDER_WALLET_ADDRESS],
    // });
    // await network.provider.request({
    //   method: "hardhat_impersonateAccount",
    //   params: [BAL_HOLDER_WALLET_ADDRESS],
    // });
    const binanceSigner = await ethers.getSigner(BINANCE_WALLET_ADDRESS);
    const binanceSigner2 = await ethers.getSigner(BINANCE_WALLET_ADDRESS_2);
    const hdaoSigner = await ethers.getSigner(HDAO_HOLDER_WALLET_ADDRESS);

    await owner.sendTransaction({
      to: BINANCE_WALLET_ADDRESS,
      value: ethers.parseEther("1.0"),
    });
    const usdcAmount: bigint =
      BigInt(100000) * BigInt(10) ** (await usdcContract.decimals()); // 1000000 USDC
    const usdtAmount: bigint =
      BigInt(100000) * BigInt(10) ** (await usdtContract.decimals()); // 1000000 USDT
    const wethAmount: bigint =
      BigInt(100) * BigInt(10) ** (await wethContract.decimals()); // 100 WETH
    const hdaoAmount: bigint =
      BigInt(100000000) * BigInt(10) ** (await hdaoContract.decimals()); // 1000000 HDAO
    await usdcContract.connect(binanceSigner).transfer(owner.address, usdcAmount)
    await hdaoContract.connect(binanceSigner).transfer(owner.address, hdaoAmount)

    // console.log("HELLO >>>>>")
    // await usdtContract.connect(binanceSigner2).transfer(owner.address, usdtAmount)
    // console.log("HELLO >>>>>>")
    // await wethContract.connect(binanceSigner).transfer(owner.address, wethAmount)
    // console.log("HELLO >>>>>>>")
    // await hdaoContract.connect(hdaoSigner).transfer(owner.address, hdaoAmount)
    // console.log("HELLO >>>>>>>>")
    // await balContract.connect(balSigner).transfer(owner.address, balAmount)

    // expect(await usdcContract.balanceOf(owner.address)).to.be.equal(usdcAmount);
    // expect(await usdtContract.balanceOf(owner.address)).to.be.equal(usdtAmount);
    // expect(await hdaoContract.balanceOf(owner.address)).to.be.equal(hdaoAmount);
    // expect(await balContract.balanceOf(owner.address)).to.be.equal(balAmount);
    // await usdcContract.connect(binanceSigner2).transfer(alice.address, usdcAmount)
    // await usdtContract.connect(binanceSigner2).transfer(alice.address, usdtAmount)
    // expect(await usdcContract.balanceOf(alice.address)).to.be.equal(usdcAmount);
    // expect(await usdtContract.balanceOf(alice.address)).to.be.equal(usdtAmount);

    return { owner, alice, bob, recipient };
  }

  // describe("Deployment & Admin", () => {
  //     it("Should be a proper address and have default settings", async () => {
  //         const { owner } = await loadFixture(deployFixture);

  //         expect(await factoryContract.getAddress()).to.be.a.properAddress;
  //         expect(await factoryContract.owner()).to.be.equal(owner.address);
  //         expect(await factoryContract.energyToken()).to.be.equal(await energyContract.getAddress());
  //     });

  //     it("Should be able to change its Owner", async () => {
  //         const { owner, alice } = await loadFixture(deployFixture);
  //         await factoryContract.transferOwnership(alice.address);
  //         expect(await factoryContract.owner()).to.be.equal(alice.address);

  //         // ERRORS
  //         await expect(factoryContract.transferOwnership(owner.address)).to.be.revertedWithCustomError(factoryContract, "OwnableUnauthorizedAccount");
  //         await expect(factoryContract.connect(alice).transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(factoryContract, "OwnableInvalidOwner");
  //     })

  //     it("Should be able to set th Burning price", async () => {
  //         const { owner, alice } = await loadFixture(deployFixture);
  //         expect(await factoryContract.burningPrice()).to.be.equal(BigInt(2));

  //         await factoryContract.setBurningPrice(BigInt(1));
  //         expect(await factoryContract.burningPrice()).to.be.equal(BigInt(1));

  //         // ERRORS
  //         await expect(factoryContract.connect(alice).setBurningPrice(BigInt(1))).to.be.revertedWithCustomError(factoryContract, "OwnableUnauthorizedAccount");
  //         await expect(factoryContract.setBurningPrice(0)).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroValue");
  //     });

  //     it("Should be able to set max mint amount", async () => {
  //         const { alice } = await loadFixture(deployFixture);
  //         const amount = 25;
  //         await factoryContract.setMaxMintAmount(amount);
  //         expect(await factoryContract.maxMintAmount()).to.be.equal(amount);

  //         // ERRORS
  //         await expect(factoryContract.connect(alice).setMaxMintAmount(amount)).to.be.revertedWithCustomError(factoryContract, "OwnableUnauthorizedAccount");
  //     });

  //     it("Should be able to set the Fixed Exchange Rates", async () => {
  //         const { alice } = await loadFixture(deployFixture);

  //         const testFixedExchangeRates = [
  //             { address: USDC_ADDRESS, amount: 250 },
  //             { address: USDT_ADDRESS, amount: 250 }];

  //         await factoryContract.setFixedExchangeRates(
  //             testFixedExchangeRates.map(a => a.address),
  //             testFixedExchangeRates.map(a => a.amount)
  //         );

  //         expect(await factoryContract.fixedExchangeRate(USDC_ADDRESS)).to.be.equal(BigInt(250));
  //         expect(await factoryContract.fixedExchangeRate(USDT_ADDRESS)).to.be.equal(BigInt(250));

  //         // ERRORS
  //         await expect(factoryContract.connect(alice).setFixedExchangeRates([ethers.ZeroAddress], [0])).to.be.revertedWithCustomError(factoryContract, "OwnableUnauthorizedAccount");
  //         await expect(factoryContract.setFixedExchangeRates([ethers.ZeroAddress], [0, 1])).to.be.revertedWithCustomError(factoryContract, "InvalidParamsLength")
  //         await expect(factoryContract.setFixedExchangeRates([ethers.ZeroAddress], [1])).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroAddress")
  //         await expect(factoryContract.setFixedExchangeRates([USDC_ADDRESS], [0])).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroValue")
  //     });

  //     it("Should be able to set the Dynamic Exchange Rates", async () => {
  //         const { alice, bob } = await loadFixture(deployFixture);

  //         const testDynamicExchangeTokens = [
  //             { address: alice.address, pool: '0xb53f4e2f1e7a1b8b9d09d2f2739ac6753f5ba5cb000200000000000000000137' },
  //             { address: bob.address, pool: '0x513f69b2e2a6fa0347529e6178002213cf60ce3d000200000000000000000c24' },
  //         ];

  //         await factoryContract.setDynamicExchangeTokens(testDynamicExchangeTokens.map(a => a.address), testDynamicExchangeTokens.map(a => a.pool));
  //         expect(await factoryContract.dynamicExchangeTokens(alice.address)).to.be.equal('0xb53f4e2f1e7a1b8b9d09d2f2739ac6753f5ba5cb000200000000000000000137');
  //         expect(await factoryContract.dynamicExchangeTokens(bob.address)).to.be.equal('0x513f69b2e2a6fa0347529e6178002213cf60ce3d000200000000000000000c24');

  //         // ERRORS
  //         await expect(factoryContract.connect(alice).setDynamicExchangeTokens([ethers.ZeroAddress],[])).to.be.revertedWithCustomError(factoryContract, "OwnableUnauthorizedAccount");
  //         await expect(factoryContract.setDynamicExchangeTokens([],[])).to.be.revertedWithCustomError(factoryContract, "InvalidParamsLength")
  //         await expect(factoryContract.setDynamicExchangeTokens([ethers.ZeroAddress],[encodeBytes32String('')])).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroAddress")
  //         await expect(factoryContract.setDynamicExchangeTokens([bob.address],[encodeBytes32String('')])).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroValue")
  //     });

  //     it("Should be able to set the Dynamic Exchange Price Deviation", async () => {
  //         const { alice } = await loadFixture(deployFixture);
  //         const percentage = 3;
  //         await factoryContract.setDynamicExchangeAcceptedDeviationPercentage(percentage);
  //         expect(await factoryContract.dynamicExchangeAcceptedDeviationPercentage()).to.be.equal(percentage);

  //         // ERRORS
  //         await expect(factoryContract.connect(alice).setDynamicExchangeAcceptedDeviationPercentage(percentage)).to.be.revertedWithCustomError(factoryContract, "OwnableUnauthorizedAccount");
  //         await expect(factoryContract.setDynamicExchangeAcceptedDeviationPercentage(0)).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroValue")
  //     });

  //     it("Should be able to change the trusted Signer", async () => {
  //         const { owner, alice, bob } = await loadFixture(deployFixture);
  //         await factoryContract.setTrustedSigner(alice.address);
  //         expect(await factoryContract.trustedSigner()).to.be.equal(alice.address);

  //         // ERRORS
  //         await expect(factoryContract.connect(bob).setTrustedSigner(owner.address)).to.be.revertedWithCustomError(factoryContract, "OwnableUnauthorizedAccount");
  //         await expect(factoryContract.setTrustedSigner(ethers.ZeroAddress)).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroAddress");
  //     })
  // });

  describe("Minting", () => {
    it("Should be able to mint using a constant swap (stablecoins)", async () => {
      const { owner, recipient } = await loadFixture(deployFixture);
      console.log("Owner USDC Balance:>>",await usdcContract.balanceOf(owner.address));
      
      //1 energy
      const amount = BigInt(100);
      expect(await usdcContract.balanceOf(factoryContract)).to.be.equal(0);
      const price = await approvePaymentToken(amount, usdcContract);
      
      await expect(factoryContract.mint(amount, USDC_ADDRESS))
        .to.emit(factoryContract, "Mint")
        .withArgs(owner.address, amount, USDC_ADDRESS, price);
      expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);
      expect(await usdcContract.balanceOf(factoryContract)).to.be.equal(
        (BigInt(price) * BigInt(80)) / BigInt(100)
      );
      expect(await usdcContract.balanceOf(recipient.address)).to.equal((price * BigInt(20)) / BigInt(100))



      // // Errors
      // await expect(factoryContract.mint(0, USDC_ADDRESS)).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroValue()");
      // await expect(factoryContract.mint(amount, ethers.ZeroAddress)).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroAddress()");
      // await expect(factoryContract.mint(amount, BINANCE_WALLET_ADDRESS)).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroValue()");
      // await expect(factoryContract.mint(amount, USDC_ADDRESS)).to.be.revertedWithCustomError(factoryContract, "Underpaid()");
    });

    it("Should not be able to mint if paused", async () => {
      const { owner } = await loadFixture(deployFixture);

      const amount = BigInt(100);
      await approvePaymentToken(amount, usdcContract);
      await energyContract.pause();
      await expect(
        factoryContract.mint(amount, USDC_ADDRESS)
      ).to.be.revertedWithCustomError(energyContract, "EnforcedPause");

      await energyContract.unpause();
      await factoryContract.mint(amount, USDC_ADDRESS);
      expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);
    });

    it.only("Should be able to mint using dynamic token pricing using HDAO", async () => {
      const { owner, recipient } = await loadFixture(deployFixture);
      const enrgAmount = BigInt(3000);
      const numberOfEnrgToMint = 30
      const expectedUSDCSwap = BigInt(numberOfEnrgToMint)*BigInt(25) * BigInt(10) ** BigInt(5);

      // Find out the minting price
      const data = factoryContract.interface.encodeFunctionData("getPrice", [
        enrgAmount,
        HDAO_ADDRESS,
      ]);
      const tx: TransactionRequest = {
        to: await factoryContract.getAddress(),
        data: data,
      };
      const res = await owner.call(tx);
      const decoded = factoryContract.interface.decodeFunctionResult(
        "getPrice",
        res
      );
      const price = BigInt(decoded.toString());

      // Aprove the payment token for the price amount
      await hdaoContract.approve(await factoryContract.getAddress(), price);

      const messageHash = ethers.solidityPackedKeccak256(["uint256"], [price]);
      const signature = await owner.signMessage(ethers.getBytes(messageHash));

      await expect(
        factoryContract.mintWithDynamic(
          enrgAmount,
          HDAO_ADDRESS,
          price,
          signature
        )
      ).to.emit(factoryContract, "Mint");

      expect(await energyContract.balanceOf(owner.address)).to.be.equal(
        enrgAmount
      );


      // Expecting 20% to be kept in HDAO
      // expect(
      //   await hdaoContract.balanceOf(await factoryContract.getAddress())
      // ).to.be.closeTo(expectedHDAOKept, 11000000);
      let EPS = 1e-5;
      // expect(
      //   await usdcContract.balanceOf(await factoryContract.getAddress())
      // ).to.be.closeTo((expectedUSDCSwap*BigInt(4)/BigInt(5)),EPS);
      
      console.log(await usdcContract.balanceOf(factoryContract.getAddress()))
      expect(await usdcContract.balanceOf(recipient.address)).to.equal((expectedUSDCSwap/BigInt(5)))
      
      // // ERRORS
      // const wrongSignature = await alice.signMessage(
      //   ethers.getBytes(messageHash)
      // );
      // await expect(
      //   factoryContract.mintWithDynamic(
      //     enrgAmount,
      //     HDAO_ADDRESS,
      //     price,
      //     wrongSignature
      //   )
      // ).to.be.revertedWithCustomError(factoryContract, "InvalidSignature");
      // const price2 = price * BigInt(2);
      // const messageHash2 = ethers.solidityPackedKeccak256(
      //   ["uint256"],
      //   [price2]
      // );
      // const signature2 = await owner.signMessage(ethers.getBytes(messageHash2));
      // await expect(
      //   factoryContract.mintWithDynamic(
      //     enrgAmount,
      //     HDAO_ADDRESS,
      //     price2,
      //     signature2
      //   )
      // ).to.be.revertedWithCustomError(
      //   factoryContract,
      //   "UnacceptablePriceDeviation"
      // );
      // await expect(
      //   factoryContract.mintWithDynamic(0, HDAO_ADDRESS, price, signature)
      // ).to.be.revertedWithCustomError(
      //   factoryContract,
      //   "InvalidParamsZeroValue"
      // );
      // await expect(
      //   factoryContract.mintWithDynamic(
      //     (await factoryContract.maxMintAmount()) + BigInt(1),
      //     HDAO_ADDRESS,
      //     price,
      //     signature
      //   )
      // ).to.be.revertedWithCustomError(factoryContract, "MaxMintAmount");
      // await expect(
      //   factoryContract.mintWithDynamic(
      //     enrgAmount,
      //     ethers.ZeroAddress,
      //     price,
      //     signature
      //   )
      // ).to.be.revertedWithCustomError(
      //   factoryContract,
      //   "InvalidParamsZeroAddress"
      // );
      // await expect(
      //   factoryContract.mintWithDynamic(
      //     enrgAmount,
      //     alice.address,
      //     price,
      //     signature
      //   )
      // ).to.be.revertedWithCustomError(
      //   factoryContract,
      //   "InvalidParamsZeroValue"
      // );
    });

    it("Should be able to mint using dynamic token pricing using BAL", async () => {
      const { owner, alice } = await loadFixture(deployFixture);

      const enrgAmount = BigInt(100);
      const expectedUSDCSwap =
        BigInt(200) * BigInt(10) ** (await usdcContract.decimals());

      // Find out the minting price
      const data = factoryContract.interface.encodeFunctionData("getPrice", [
        enrgAmount,
        BAL_ADDRESS,
      ]);
      const tx: TransactionRequest = {
        to: await factoryContract.getAddress(),
        data: data,
      };
      const res = await owner.call(tx);
      const decoded = factoryContract.interface.decodeFunctionResult(
        "getPrice",
        res
      );
      const price = BigInt(decoded.toString());

      const messageHash = ethers.solidityPackedKeccak256(["uint256"], [price]);
      const signature = await owner.signMessage(ethers.getBytes(messageHash));

      // Aprove the payment token for the price amount
      await balContract.approve(await factoryContract.getAddress(), price);

      await expect(
        factoryContract.mintWithDynamic(
          enrgAmount,
          BAL_ADDRESS,
          price,
          signature
        )
      ).to.emit(factoryContract, "Mint");

      expect(await energyContract.balanceOf(owner.address)).to.be.equal(
        enrgAmount
      );

      // Expecting 23% to be kept in HDAO the rest in USDC
      expect(
        await hdaoContract.balanceOf(await factoryContract.getAddress())
      ).to.be.greaterThan(0);
      expect(
        await usdcContract.balanceOf(await factoryContract.getAddress())
      ).to.be.closeTo(expectedUSDCSwap, 10000000);

      // ERRORS
      const wrongSignature = await alice.signMessage(
        ethers.getBytes(messageHash)
      );
      await expect(
        factoryContract.mintWithDynamic(
          enrgAmount,
          BAL_ADDRESS,
          price,
          wrongSignature
        )
      ).to.be.revertedWithCustomError(factoryContract, "InvalidSignature");
      const price2 = price * BigInt(2);
      const messageHash2 = ethers.solidityPackedKeccak256(
        ["uint256"],
        [price2]
      );
      const signature2 = await owner.signMessage(ethers.getBytes(messageHash2));
      await expect(
        factoryContract.mintWithDynamic(
          enrgAmount,
          BAL_ADDRESS,
          price2,
          signature2
        )
      ).to.be.revertedWithCustomError(
        factoryContract,
        "UnacceptablePriceDeviation"
      );
      await expect(
        factoryContract.mintWithDynamic(0, BAL_ADDRESS, price, signature)
      ).to.be.revertedWithCustomError(
        factoryContract,
        "InvalidParamsZeroValue"
      );
      await expect(
        factoryContract.mintWithDynamic(
          (await factoryContract.maxMintAmount()) + BigInt(1),
          BAL_ADDRESS,
          price,
          signature
        )
      ).to.be.revertedWithCustomError(factoryContract, "MaxMintAmount");
      await expect(
        factoryContract.mintWithDynamic(
          enrgAmount,
          ethers.ZeroAddress,
          price,
          signature
        )
      ).to.be.revertedWithCustomError(
        factoryContract,
        "InvalidParamsZeroAddress"
      );
      await expect(
        factoryContract.mintWithDynamic(
          enrgAmount,
          alice.address,
          price,
          signature
        )
      ).to.be.revertedWithCustomError(
        factoryContract,
        "InvalidParamsZeroValue"
      );
    });
  });

  describe("Dynamic Exchange Rates", () => {
    it("Should be able to get the Dynamic Exchange Rate", async () => {
      const { alice } = await loadFixture(deployFixture);
      const enrgAmount = BigInt(100);

      const data = factoryContract.interface.encodeFunctionData("getPrice", [
        enrgAmount,
        HDAO_ADDRESS,
      ]);
      const tx: TransactionRequest = {
        to: await factoryContract.getAddress(),
        data: data,
      };
      const res = await alice.call(tx);
      const decoded = factoryContract.interface.decodeFunctionResult(
        "getPrice",
        res
      );

      expect(+decoded.toString()).to.be.greaterThan(0);
    });
  });

  describe("Burning", () => {
    it("Should be able to burn", async () => {
      const { owner } = await loadFixture(deployFixture);

      const amount = BigInt(100);
      const price = await approvePaymentToken(amount, usdcContract);
      console.log(price);

      await factoryContract.mint(amount, USDC_ADDRESS);
      expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);
      expect(await usdcContract.balanceOf(factoryContract)).to.be.equal(
        (price * BigInt(80)) / BigInt(100)
      );

      const burningPrice =
        ((await factoryContract.burningPrice()) *
          BigInt(10) ** (await usdcContract.decimals()) *
          amount) /
        BigInt(10) ** BigInt(2);
      console.log(
        "🚀 ~ file: Factory.test.ts:391 ~ it ~ burningPrice:",
        burningPrice
      );
      const ownerUsdcBefore = await usdcContract.balanceOf(owner.address);
      console.log(ownerUsdcBefore);
      await expect(factoryContract.burn(amount, USDC_ADDRESS))
        .to.emit(factoryContract, "Burn")
        .withArgs(owner.address, amount, USDC_ADDRESS, burningPrice);

      expect(await energyContract.balanceOf(owner.address)).to.be.equal(0);
      expect(await usdcContract.balanceOf(owner.address)).to.be.equal(
        ownerUsdcBefore + burningPrice
      );
    });

    it("Should be able to burn and get a different payment token", async () => {
      const { owner, alice } = await loadFixture(deployFixture);

      const amountOwner = BigInt(400);
      const amountAlice = amountOwner / BigInt(4);

      const priceUSDT = await approvePaymentToken(amountOwner, usdtContract);
      await factoryContract.mint(amountOwner, USDT_ADDRESS);

      const priceUSDC = await approvePaymentToken(
        amountAlice,
        usdcContract,
        alice
      );
      await factoryContract.connect(alice).mint(amountAlice, USDC_ADDRESS);

      const ownerUsdtBefore = await usdtContract.balanceOf(owner.address);
      const ownerUsdcBefore = await usdcContract.balanceOf(owner.address);
      const aliceUsdtBefore = await usdtContract.balanceOf(alice.address);
      const aliceUsdcBefore = await usdcContract.balanceOf(alice.address);
      const burningPrice =
        (await factoryContract.burningPrice()) *
        BigInt(10) ** (await usdtContract.decimals()) *
        amountAlice;
      await expect(
        factoryContract.connect(alice).burn(amountAlice, USDT_ADDRESS)
      )
        .to.emit(factoryContract, "Burn")
        .withArgs(alice.address, amountAlice, USDT_ADDRESS, burningPrice);

      expect(await energyContract.balanceOf(alice.address)).to.be.equal(0);
      expect(await usdtContract.balanceOf(alice.address)).to.be.equal(
        aliceUsdtBefore + burningPrice
      );
      expect(await usdcContract.balanceOf(alice.address)).to.be.equal(
        aliceUsdcBefore
      );

      // Owner still have the same balances (after his mint and alice burn)
      expect(await energyContract.balanceOf(owner.address)).to.be.equal(
        amountOwner
      );
      expect(await usdtContract.balanceOf(owner.address)).to.be.equal(
        ownerUsdtBefore
      );
      expect(await usdcContract.balanceOf(owner.address)).to.be.equal(
        ownerUsdcBefore
      );

      // Errors
      await expect(
        factoryContract.burn(0, USDT_ADDRESS)
      ).to.be.revertedWithCustomError(
        factoryContract,
        "InvalidParamsZeroValue"
      );
      await expect(
        factoryContract.burn(amountOwner, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(
        factoryContract,
        "InvalidParamsZeroAddress"
      );
      await expect(
        factoryContract.burn(amountOwner * BigInt(2), USDT_ADDRESS)
      ).to.be.revertedWithCustomError(factoryContract, "NotEnoughFunds");
    });

    it("Should not be able to burn if paused", async () => {
      const { owner } = await loadFixture(deployFixture);

      const amount = BigInt(100);
      const price = await approvePaymentToken(amount, usdcContract);

      await factoryContract.mint(amount, USDC_ADDRESS);
      expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);

      await energyContract.pause();
      await expect(
        factoryContract.burn(amount, USDC_ADDRESS)
      ).to.be.revertedWithCustomError(energyContract, "EnforcedPause");

      await energyContract.unpause();

      const burningPrice =
        ((await factoryContract.burningPrice()) *
          BigInt(10) ** (await usdcContract.decimals()) *
          amount) /
        BigInt(10) ** BigInt(2);
      await expect(factoryContract.burn(amount, USDC_ADDRESS))
        .to.emit(factoryContract, "Burn")
        .withArgs(owner.address, amount, USDC_ADDRESS, burningPrice);
      expect(await energyContract.balanceOf(owner.address)).to.be.equal(0);
    });
  });

  describe("Withdrawals", () => {
    describe("Validations", () => {
      it("Should revert with the right error if called from another account", async () => {
        const { alice } = await loadFixture(deployFixture);
        await expect(
          factoryContract.connect(alice).withdraw(USDC_ADDRESS)
        ).to.be.revertedWithCustomError(
          factoryContract,
          "OwnableUnauthorizedAccount"
        );
      });
    });

    describe("Events", function () {
      it("Should emit an event on withdrawals", async () => {
        const { owner } = await loadFixture(deployFixture);

        await expect(factoryContract.withdraw(USDC_ADDRESS)).to.emit(
          factoryContract,
          "Withdrawal"
        );
      });
    });

    describe("Transfers", function () {
      it("Should transfer the funds (ERC20) to the owner", async function () {
        const { owner } = await loadFixture(deployFixture);

        const amount = BigInt(100);
        const price = await approvePaymentToken(amount, usdcContract);
        await factoryContract.mint(amount, USDC_ADDRESS);

        const balanceBefore = await usdcContract.balanceOf(owner.address);

        await expect(factoryContract.withdraw(USDC_ADDRESS)).to.emit(
          factoryContract,
          "Withdrawal"
        );
        expect(
          await usdcContract.balanceOf(await factoryContract.getAddress())
        ).to.be.equal(0);
        expect(await usdcContract.balanceOf(owner.address)).to.be.equal(
          price + balanceBefore
        );
      });
    });

    describe("Reentrancy Protection", function () {
      it("Should trigger Reentrancy Error on minting using a constant swap (stablecoins)", async function () {
        const { owner } = await loadFixture(deployFixture);

        const factoryAddress = await factoryContract.getAddress();
        const contractReentrancy = await ethers.getContractFactory(
          "Reentrancy"
        );
        reentrancyContract = await contractReentrancy.deploy(factoryAddress);
        await reentrancyContract.waitForDeployment();

        const reentrancyAddress = await reentrancyContract.getAddress();

        await factoryContract.setFixedExchangeRates(
          [reentrancyAddress],
          ["666"]
        );
        await factoryContract.setDynamicExchangeTokens(
          [reentrancyAddress],
          ["0xb53f4e2f1e7a1b8b9d09d2f2739ac6753f5ba5cb000200000000000000000137"]
        );

        await expect(
          reentrancyContract.attackMint()
        ).to.be.revertedWithCustomError(
          factoryContract,
          "ReentrancyGuardReentrantCall"
        );
      });
    });
  });
});
