import {ethers} from "hardhat";
import {ITEM_NFT_LIBRARY_ADDRESS, ITEM_NFT_ADDRESS} from "./contractAddresses";

import {allItems} from "./data/items";

async function main() {
  const ItemNFT = await ethers.getContractFactory("ItemNFT", {libraries: {ItemNFTLibrary: ITEM_NFT_LIBRARY_ADDRESS}});
  const itemNFT = await ItemNFT.attach(ITEM_NFT_ADDRESS);

  const chunkSize = 100;
  for (let i = 0; i < allItems.length; i += chunkSize) {
    const tokenIds: number[] = [];
    const amounts: number[] = [];
    const chunk = allItems.slice(i, i + chunkSize);
    chunk.forEach((item) => {
      tokenIds.push(item.tokenId);
      amounts.push(1);
    });
    await itemNFT.testMints("0xa801864d0D24686B15682261aa05D4e1e6e5BD94", tokenIds, amounts);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
