import {ethers} from "hardhat";
import {QUESTS_ADDRESS} from "./contractAddresses";
import {Quest, allQuests, allQuestsMinRequirements, defaultMinRequirements} from "./data/quests";

async function main() {
  const [owner] = await ethers.getSigners();
  console.log(`Edit quest using account: ${owner.address}`);

  const network = await ethers.provider.getNetwork();
  console.log(`ChainId: ${network.chainId}`);

  const Quests = await ethers.getContractFactory("Quests");
  const quests = await Quests.attach(QUESTS_ADDRESS);

  const tx = await quests.editQuests(allQuests, allQuestsMinRequirements);
  await tx.wait();

  // Single one
  //  const quest = allQuests.find((q) => q.questId === QUEST_IRON_AGE) as Quest;
  //  const tx = await quests.editQuest(quest, defaultMinRequirements);
  //  await tx.wait();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
