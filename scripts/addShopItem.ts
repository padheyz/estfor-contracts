import {MEDIUM_NET} from "@paintswap/estfor-definitions/constants";
import {ethers} from "hardhat";
import {SHOP_ADDRESS} from "./contractAddresses";

async function main() {
  const [owner] = await ethers.getSigners();
  console.log(`Add shop item using account: ${owner.address}`);

  const network = await ethers.provider.getNetwork();
  console.log(`ChainId: ${network.chainId}`);

  const Shop = await ethers.getContractFactory("Shop");
  const shop = Shop.attach(SHOP_ADDRESS);

  await shop.addBuyableItem({price: ethers.utils.parseEther("50"), tokenId: MEDIUM_NET});
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
