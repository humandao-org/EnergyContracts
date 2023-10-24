import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { TransactionRequest, encodeBytes32String } from "ethers";
import { ethers, network } from "hardhat";
import { Energy, Factory, IERC20, IERC20Metadata, Reentrancy } from "../typechain-types";

const BINANCE_WALLET_ADDRESS = '0xf977814e90da44bfa03b6295a0616a897441acec'; // This might stop working at some point (if they move their funds)
const BINANCE_WALLET_ADDRESS_2 = '0xe7804c37c13166ff0b37f5ae0bb07a3aebb6e245'; // This might stop working at some point (if they move their funds)
const HDAO_HOLDER_WALLET_ADDRESS = '0x08c724340c1438fe5e20b84ba9cac89a20144414'; // This might stop working at some point (if they move their funds)
const BAL_HOLDER_WALLET_ADDRESS = '0x8832924854e3cedb0a6abf372e6ccff9f7654332'; // This might stop working at some point (if they move their funds)
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const USDT_ADDRESS = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const WETH_ADDRESS = '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619';
const BAL_ADDRESS = '0x9a71012b13ca4d3d0cdc72a177df3ef03b0e76a3';
const HDAO_ADDRESS = '0x72928d5436Ff65e57F72D5566dCd3BaEDC649A88';

const fixedExchangeRates = [
    { address: USDC_ADDRESS, amount: 4 },
    { address: USDT_ADDRESS, amount: 2 },
];

const dynamicExchangeTokens = [
    { address: HDAO_ADDRESS, pool: '0xb53f4e2f1e7a1b8b9d09d2f2739ac6753f5ba5cb000200000000000000000137' },
    { address: BAL_ADDRESS, pool: '0x3d468ab2329f296e1b9d8476bb54dd77d8c2320f000200000000000000000426' },
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
            params: [{
                forking: { jsonRpcUrl: 'https://polygon-mainnet.g.alchemy.com/v2/' + process.env.ALCHEMY_TOKEN }
            }]
        });
    });

    async function approvePaymentToken(amount: bigint, paymentToken: IERC20, account?: HardhatEthersSigner): Promise<bigint> {
        const exchangeRate = await factoryContract.fixedExchangeRate(await paymentToken.getAddress());
        const price = amount * BigInt(exchangeRate)
        if(!account) {
            const [owner] = await ethers.getSigners();
            account = owner;
        }

        await paymentToken.connect(account).approve(await factoryContract.getAddress(), price);
        return price
    }

    async function deployFixture() {
        const [owner, alice, bob] = await ethers.getSigners();
        usdcContract = await ethers.getContractAt("IERC20Metadata", USDC_ADDRESS);
        usdtContract = await ethers.getContractAt("IERC20Metadata", USDT_ADDRESS);
        wethContract = await ethers.getContractAt("IERC20Metadata", WETH_ADDRESS);
        hdaoContract = await ethers.getContractAt("IERC20Metadata", HDAO_ADDRESS);
        balContract = await ethers.getContractAt("IERC20Metadata", BAL_ADDRESS);

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
            BigInt("3000"),
            fixedExchangeRates.map(a => a.address),
            fixedExchangeRates.map(a => a.amount),
            dynamicExchangeTokens.map(a => a.address),
            dynamicExchangeTokens.map(a => a.pool)
        );

        // Setting Factory
        energyContract.setFactory(await factoryContract.getAddress());

        // Get some USDC and USDT from some accounts
        await network.provider.request({ method: "hardhat_impersonateAccount", params: [BINANCE_WALLET_ADDRESS]});
        await network.provider.request({ method: "hardhat_impersonateAccount", params: [BINANCE_WALLET_ADDRESS_2]});
        await network.provider.request({ method: "hardhat_impersonateAccount", params: [HDAO_HOLDER_WALLET_ADDRESS]});
        await network.provider.request({ method: "hardhat_impersonateAccount", params: [BAL_HOLDER_WALLET_ADDRESS]});
        const binanceSigner = await ethers.getSigner(BINANCE_WALLET_ADDRESS);
        const binanceSigner2 = await ethers.getSigner(BINANCE_WALLET_ADDRESS_2);
        const hdaoSigner = await ethers.getSigner(HDAO_HOLDER_WALLET_ADDRESS);
        const balSigner = await ethers.getSigner(BAL_HOLDER_WALLET_ADDRESS);
        
        await owner.sendTransaction({ to: BINANCE_WALLET_ADDRESS, value: ethers.parseEther("1.0") });
        await owner.sendTransaction({ to: BINANCE_WALLET_ADDRESS_2, value: ethers.parseEther("1.0") });
        await owner.sendTransaction({ to: HDAO_HOLDER_WALLET_ADDRESS, value: ethers.parseEther("1.0") });
        await owner.sendTransaction({ to: BAL_HOLDER_WALLET_ADDRESS, value: ethers.parseEther("1.0") });

        const usdcAmount: bigint = BigInt(100000) * BigInt(10)**await usdcContract.decimals(); // 100000 USDC
        const usdtAmount: bigint = BigInt(100000) * BigInt(10)**await usdcContract.decimals(); // 100000 USDT
        const wethAmount: bigint = BigInt(100) * BigInt(10)**await wethContract.decimals(); // 100 WETH
        const hdaoAmount: bigint = BigInt(1000000) * BigInt(10)**await hdaoContract.decimals(); // 1000000 HDAO
        const balAmount: bigint = BigInt(10000) * BigInt(10)**await balContract.decimals(); // 10000 BAL
        await usdcContract.connect(binanceSigner2).transfer(owner.address, usdcAmount)
        await usdtContract.connect(binanceSigner2).transfer(owner.address, usdtAmount)
        await wethContract.connect(binanceSigner).transfer(owner.address, wethAmount)
        await hdaoContract.connect(hdaoSigner).transfer(owner.address, hdaoAmount)
        await balContract.connect(balSigner).transfer(owner.address, balAmount)
        expect(await usdcContract.balanceOf(owner.address)).to.be.equal(usdcAmount);
        expect(await usdtContract.balanceOf(owner.address)).to.be.equal(usdtAmount);
        expect(await hdaoContract.balanceOf(owner.address)).to.be.equal(hdaoAmount);
        expect(await balContract.balanceOf(owner.address)).to.be.equal(balAmount);
        await usdcContract.connect(binanceSigner2).transfer(alice.address, usdcAmount)
        await usdtContract.connect(binanceSigner2).transfer(alice.address, usdtAmount)
        expect(await usdcContract.balanceOf(alice.address)).to.be.equal(usdcAmount);
        expect(await usdtContract.balanceOf(alice.address)).to.be.equal(usdtAmount);

        return { owner, alice, bob };
    }

    describe("Deployment & Admin", () => {
        it("Should be a proper address and have default settings", async () => {
            const { owner } = await loadFixture(deployFixture);
            expect(await factoryContract.getAddress()).to.be.a.properAddress;
            expect(await factoryContract.owner()).to.be.equal(owner.address);
            expect(await factoryContract.energyToken()).to.be.equal(await energyContract.getAddress());
        });

        it("Should be able to change its Owner", async () => {
            const { owner, alice } = await loadFixture(deployFixture);
            await factoryContract.transferOwnership(alice.address);
            expect(await factoryContract.owner()).to.be.equal(alice.address);

            // ERRORS
            await expect(factoryContract.transferOwnership(owner.address)).to.be.revertedWithCustomError(factoryContract, "OwnableUnauthorizedAccount");
            await expect(factoryContract.connect(alice).transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(factoryContract, "OwnableInvalidOwner");
        })

        it("Should be able to set max mint amount", async () => {
            const { alice } = await loadFixture(deployFixture);
            const amount = 25;
            await factoryContract.setMaxMintAmount(amount);
            expect(await factoryContract.maxMintAmount()).to.be.equal(amount);

            // ERRORS
            await expect(factoryContract.connect(alice).setMaxMintAmount(amount)).to.be.revertedWithCustomError(factoryContract, "OwnableUnauthorizedAccount");
        });

        it("Should be able to set the Fixed Exchange Rates", async () => {
            const { alice } = await loadFixture(deployFixture);

            const testFixedExchangeRates = [
                { address: USDC_ADDRESS, amount: 23 },
                { address: USDT_ADDRESS, amount: 42 }];
            
            await factoryContract.setFixedExchangeRates(
                testFixedExchangeRates.map(a => a.address), 
                testFixedExchangeRates.map(a => a.amount)
            );

            expect(await factoryContract.fixedExchangeRate(USDC_ADDRESS)).to.be.equal(23);
            expect(await factoryContract.fixedExchangeRate(USDT_ADDRESS)).to.be.equal(42);

            // ERRORS
            await expect(factoryContract.connect(alice).setFixedExchangeRates([ethers.ZeroAddress], [0])).to.be.revertedWithCustomError(factoryContract, "OwnableUnauthorizedAccount");
            await expect(factoryContract.setFixedExchangeRates([ethers.ZeroAddress], [0, 1])).to.be.revertedWithCustomError(factoryContract, "InvalidParamsLength")
            await expect(factoryContract.setFixedExchangeRates([ethers.ZeroAddress], [1])).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroAddress")
            await expect(factoryContract.setFixedExchangeRates([USDC_ADDRESS], [0])).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroValue")
        });

        it("Should be able to set the Dynamic Exchange Rates", async () => {
            const { alice, bob } = await loadFixture(deployFixture);

            const testDynamicExchangeTokens = [
                { address: alice.address, pool: '0xb53f4e2f1e7a1b8b9d09d2f2739ac6753f5ba5cb000200000000000000000137' },
                { address: bob.address, pool: '0x513f69b2e2a6fa0347529e6178002213cf60ce3d000200000000000000000c24' },
            ];

            await factoryContract.setDynamicExchangeTokens(testDynamicExchangeTokens.map(a => a.address), testDynamicExchangeTokens.map(a => a.pool));
            expect(await factoryContract.dynamicExchangeTokens(alice.address)).to.be.equal('0xb53f4e2f1e7a1b8b9d09d2f2739ac6753f5ba5cb000200000000000000000137');
            expect(await factoryContract.dynamicExchangeTokens(bob.address)).to.be.equal('0x513f69b2e2a6fa0347529e6178002213cf60ce3d000200000000000000000c24');

            // ERRORS
            await expect(factoryContract.connect(alice).setDynamicExchangeTokens([ethers.ZeroAddress],[])).to.be.revertedWithCustomError(factoryContract, "OwnableUnauthorizedAccount");
            await expect(factoryContract.setDynamicExchangeTokens([],[])).to.be.revertedWithCustomError(factoryContract, "InvalidParamsLength")
            await expect(factoryContract.setDynamicExchangeTokens([ethers.ZeroAddress],[encodeBytes32String('')])).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroAddress")
            await expect(factoryContract.setDynamicExchangeTokens([bob.address],[encodeBytes32String('')])).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroValue")
        });

        it("Should be able to set the Dynamic Exchange Price Deviation", async () => {
            const { alice } = await loadFixture(deployFixture);
            const percentage = 3;
            await factoryContract.setDynamicExchangeAcceptedDeviationPercentage(percentage);
            expect(await factoryContract.dynamicExchangeAcceptedDeviationPercentage()).to.be.equal(percentage);

            // ERRORS
            await expect(factoryContract.connect(alice).setDynamicExchangeAcceptedDeviationPercentage(percentage)).to.be.revertedWithCustomError(factoryContract, "OwnableUnauthorizedAccount");
            await expect(factoryContract.setDynamicExchangeAcceptedDeviationPercentage(0)).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroValue")
        });
    });

    describe("Minting", () => {
        it("Should be able to mint using a constant swap (stablecoins)", async () => {
            const { owner } = await loadFixture(deployFixture);
            
            const amount = BigInt(100);
            expect(await usdcContract.balanceOf(factoryContract)).to.be.equal(0);
            const price = await approvePaymentToken(amount, usdcContract);
            await expect(factoryContract.mint(amount, USDC_ADDRESS))
                .to.emit(factoryContract, "Mint")
                .withArgs(owner.address, amount, USDC_ADDRESS, price);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);
            expect(await usdcContract.balanceOf(factoryContract)).to.be.equal(price);

            // Errors
            await expect(factoryContract.mint(0, USDC_ADDRESS)).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroValue()");
            await expect(factoryContract.mint(amount, ethers.ZeroAddress)).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroAddress()");
            await expect(factoryContract.mint(amount, BINANCE_WALLET_ADDRESS)).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroValue()");
            await expect(factoryContract.mint(amount, USDC_ADDRESS)).to.be.revertedWithCustomError(factoryContract, "Underpaid()");
        });

        it("Should not be able to mint if paused", async () => {
            const { owner } = await loadFixture(deployFixture);

            const amount = BigInt(100);
            await approvePaymentToken(amount, usdcContract);
            await energyContract.pause();
            await expect(factoryContract.mint(amount, USDC_ADDRESS)).to.be.revertedWithCustomError(energyContract, "EnforcedPause");

            await energyContract.unpause();
            await factoryContract.mint(amount, USDC_ADDRESS);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);
        });

        it("Should be able to mint using dynamic token pricing using HDAO", async () => {
            const { owner, alice } = await loadFixture(deployFixture);
            const enrgAmount = BigInt(100);
            const expectedUSDCSwap = BigInt(200) * BigInt(10)**await usdcContract.decimals();

            // Find out the minting price
            const data = factoryContract.interface.encodeFunctionData("getPrice", [enrgAmount, HDAO_ADDRESS]);
            const tx: TransactionRequest = {
                to: await factoryContract.getAddress(),
                data: data
            }
            const res = await owner.call(tx);
            const decoded = factoryContract.interface.decodeFunctionResult("getPrice", res);
            const price = BigInt(decoded.toString());

            // Aprove the payment token for the price amount
            await hdaoContract.approve(await factoryContract.getAddress(), price);
            
            const messageHash = ethers.solidityPackedKeccak256(['uint256'], [price]);
            const signature = await owner.signMessage(ethers.getBytes(messageHash));
            
            await expect(factoryContract.mintWithDynamic(enrgAmount, HDAO_ADDRESS, price, signature))
                .to.emit(factoryContract, "Mint");

            expect(await energyContract.balanceOf(owner.address)).to.be.equal(enrgAmount);

            // Expecting 23% to be kept in HDAO
            let expectedHDAOKept = price*BigInt(23)/BigInt(100);
            expect(await hdaoContract.balanceOf(await factoryContract.getAddress())).to.be.closeTo(expectedHDAOKept, 11000000);
            expect(await usdcContract.balanceOf(await factoryContract.getAddress())).to.be.closeTo(expectedUSDCSwap, 11000000);

            // ERRORS
            const wrongSignature = await alice.signMessage(ethers.getBytes(messageHash));
            await expect(factoryContract.mintWithDynamic(enrgAmount, HDAO_ADDRESS, price, wrongSignature)).to.be.revertedWithCustomError(factoryContract, "InvalidSignature");
            await expect(factoryContract.mintWithDynamic(0, HDAO_ADDRESS, price, signature)).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroValue");
            await expect(factoryContract.mintWithDynamic((await factoryContract.maxMintAmount())+BigInt(1), HDAO_ADDRESS, price, signature)).to.be.revertedWithCustomError(factoryContract, "MaxMintAmount");
            await expect(factoryContract.mintWithDynamic(enrgAmount, ethers.ZeroAddress, price, signature)).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroAddress");
            await expect(factoryContract.mintWithDynamic(enrgAmount, alice.address, price, signature)).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroValue");
        });

        it("Should be able to mint using dynamic token pricing using BAL", async () => {
            const { owner, alice } = await loadFixture(deployFixture);

            const enrgAmount = BigInt(100);
            const expectedUSDCSwap = BigInt(200) * BigInt(10)**await usdcContract.decimals();

            // Find out the minting price
            const data = factoryContract.interface.encodeFunctionData("getPrice", [enrgAmount, BAL_ADDRESS]);
            const tx: TransactionRequest = {
                to: await factoryContract.getAddress(),
                data: data
            }
            const res = await owner.call(tx);
            const decoded = factoryContract.interface.decodeFunctionResult("getPrice", res);
            const price = BigInt(decoded.toString());

            const messageHash = ethers.solidityPackedKeccak256(['uint256'], [price]);
            const signature = await owner.signMessage(ethers.getBytes(messageHash));

            // Aprove the payment token for the price amount
            await balContract.approve(await factoryContract.getAddress(), price);

            await expect(factoryContract.mintWithDynamic(enrgAmount, BAL_ADDRESS, price, signature))
                .to.emit(factoryContract, "Mint");

            expect(await energyContract.balanceOf(owner.address)).to.be.equal(enrgAmount);

            // Expecting 23% to be kept in HDAO the rest in USDC
            expect(await hdaoContract.balanceOf(await factoryContract.getAddress())).to.be.greaterThan(0);
            expect(await usdcContract.balanceOf(await factoryContract.getAddress())).to.be.closeTo(expectedUSDCSwap, 10000000);

            // ERRORS
            const wrongSignature = await alice.signMessage(ethers.getBytes(messageHash));
            await expect(factoryContract.mintWithDynamic(enrgAmount, BAL_ADDRESS, price, wrongSignature)).to.be.revertedWithCustomError(factoryContract, "InvalidSignature");
            await expect(factoryContract.mintWithDynamic(0, BAL_ADDRESS, price, signature)).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroValue");
            await expect(factoryContract.mintWithDynamic((await factoryContract.maxMintAmount())+BigInt(1), BAL_ADDRESS, price, signature)).to.be.revertedWithCustomError(factoryContract, "MaxMintAmount");
            await expect(factoryContract.mintWithDynamic(enrgAmount, ethers.ZeroAddress, price, signature)).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroAddress");
            await expect(factoryContract.mintWithDynamic(enrgAmount, alice.address, price, signature)).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroValue");
        });
    });

    describe("Dynamic Exchange Rates", () => {
        it("Should be able to get the Dynamic Exchange Rate", async () => {
            const { alice } = await loadFixture(deployFixture);
            const enrgAmount = BigInt(100);

            const data = factoryContract.interface.encodeFunctionData("getPrice", [enrgAmount, HDAO_ADDRESS]);
            const tx: TransactionRequest = {
                to: await factoryContract.getAddress(),
                data: data
            }
            const res = await alice.call(tx);
            const decoded = factoryContract.interface.decodeFunctionResult("getPrice", res);

            expect(+(decoded.toString())).to.be.greaterThan(0);
        });
    });

    describe("Burning", () => {
        it("Should be able to burn", async () => {
            const { owner } = await loadFixture(deployFixture);

            const amount = BigInt(100);
            const price = await approvePaymentToken(amount, usdcContract);
            await factoryContract.mint(amount, USDC_ADDRESS);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);
            expect(await usdcContract.balanceOf(factoryContract)).to.be.equal(price);

            const ownerUsdcBefore = await usdcContract.balanceOf(owner.address);
            await expect(factoryContract.burn(amount, USDC_ADDRESS))
                .to.emit(factoryContract, "Burn")
                .withArgs(owner.address, amount, USDC_ADDRESS, price);

            expect(await energyContract.balanceOf(owner.address)).to.be.equal(0);
            expect(await usdcContract.balanceOf(owner.address)).to.be.equal(ownerUsdcBefore+price);
        });

        it("Should be able to burn and get a different payment token", async () => {
            const { owner, alice } = await loadFixture(deployFixture);

            const amountOwner = BigInt(400);
            const amountAlice = amountOwner/BigInt(4);

            const priceUSDT = await approvePaymentToken(amountOwner, usdtContract);
            await factoryContract.mint(amountOwner, USDT_ADDRESS);

            const priceUSDC = await approvePaymentToken(amountAlice, usdcContract, alice);
            await factoryContract.connect(alice).mint(amountAlice, USDC_ADDRESS);

            const ownerUsdtBefore = await usdtContract.balanceOf(owner.address);
            const ownerUsdcBefore = await usdcContract.balanceOf(owner.address);
            const aliceUsdtBefore = await usdtContract.balanceOf(alice.address);
            const aliceUsdcBefore = await usdcContract.balanceOf(alice.address);
            await expect(factoryContract.connect(alice).burn(amountAlice, USDT_ADDRESS))
                .to.emit(factoryContract, "Burn")
                .withArgs(alice.address, amountAlice, USDT_ADDRESS, priceUSDT/BigInt(4));

            expect(await energyContract.balanceOf(alice.address)).to.be.equal(0);
            expect(await usdtContract.balanceOf(alice.address)).to.be.equal(aliceUsdtBefore+priceUSDT/BigInt(4));
            expect(await usdcContract.balanceOf(alice.address)).to.be.equal(aliceUsdcBefore);

            // Owner still have the same balances (after his mint and alice burn)
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amountOwner);
            expect(await usdtContract.balanceOf(owner.address)).to.be.equal(ownerUsdtBefore);
            expect(await usdcContract.balanceOf(owner.address)).to.be.equal(ownerUsdcBefore);

            // Errors
            await expect(factoryContract.burn(0, USDT_ADDRESS)).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroValue");
            await expect(factoryContract.burn(amountOwner, ethers.ZeroAddress)).to.be.revertedWithCustomError(factoryContract, "InvalidParamsZeroAddress");
            await expect(factoryContract.burn(amountOwner*BigInt(2), USDT_ADDRESS)).to.be.revertedWithCustomError(factoryContract, "NotEnoughFunds");
        });

        it("Should not be able to burn if paused", async () => {
            const { owner } = await loadFixture(deployFixture);

            const amount = BigInt(100);
            const price = await approvePaymentToken(amount, usdcContract);

            await factoryContract.mint(amount, USDC_ADDRESS);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(amount);

            await energyContract.pause();
            await expect(factoryContract.burn(amount, USDC_ADDRESS)).to.be.revertedWithCustomError(energyContract, "EnforcedPause");

            await energyContract.unpause();
            await expect(factoryContract.burn(amount, USDC_ADDRESS))
                .to.emit(factoryContract, "Burn")
                .withArgs(owner.address, amount, USDC_ADDRESS, price);
            expect(await energyContract.balanceOf(owner.address)).to.be.equal(0);
        });
    });

    describe("Withdrawals", () => {
        describe("Validations", () => {    
            it("Should revert with the right error if called from another account", async () => {
                const { alice } = await loadFixture(deployFixture);
                await expect(factoryContract.connect(alice).withdraw(USDC_ADDRESS)).to.be.revertedWithCustomError(factoryContract, "OwnableUnauthorizedAccount");
            });
        });
    
        describe("Events", function () {
            it("Should emit an event on withdrawals", async () => {
                const { owner } = await loadFixture(deployFixture);

                await expect(factoryContract.withdraw(USDC_ADDRESS)).to.emit(factoryContract, "Withdrawal");
            });
        });
    
        describe("Transfers", function () {
            it("Should transfer the funds (ERC20) to the owner", async function () {
                const { owner } = await loadFixture(deployFixture);

                const amount = BigInt(100);
                const price = await approvePaymentToken(amount, usdcContract);
                await factoryContract.mint(amount, USDC_ADDRESS);

                const balanceBefore = await usdcContract.balanceOf(owner.address);

                await expect(factoryContract.withdraw(USDC_ADDRESS)).to.emit(factoryContract, "Withdrawal");
                expect(await usdcContract.balanceOf(await factoryContract.getAddress())).to.be.equal(0);
                expect(await usdcContract.balanceOf(owner.address)).to.be.equal(price+balanceBefore);
            });
        });

        describe("Reentrancy Protection", function () {
            it("Should trigger Reentrancy Error on minting using a constant swap (stablecoins)", async function () {
                const { owner } = await loadFixture(deployFixture);

                const factoryAddress = await factoryContract.getAddress();
                const contractReentrancy = await ethers.getContractFactory("Reentrancy");
                reentrancyContract = await contractReentrancy.deploy(factoryAddress);
                await reentrancyContract.waitForDeployment();

                const reentrancyAddress = await reentrancyContract.getAddress();

                await factoryContract.setFixedExchangeRates([reentrancyAddress], ['666'])
                await factoryContract.setDynamicExchangeTokens([reentrancyAddress], ['0xb53f4e2f1e7a1b8b9d09d2f2739ac6753f5ba5cb000200000000000000000137']);

                await expect(reentrancyContract.attackMint()).to.be.revertedWithCustomError(factoryContract, "ReentrancyGuardReentrantCall");
            });
        });
    });
});