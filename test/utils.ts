import {EstforConstants, EstforTypes} from "@paintswap/estfor-definitions";
import {ContractTransaction} from "ethers";

export const getRequestId = async (tx: ContractTransaction): Promise<number> => {
  const receipt = await tx.wait();
  const event = receipt?.events?.filter((x) => {
    return x.event == "RequestSent";
  })[0].args;
  return event?.requestId.toNumber();
};

export const getActionId = async (tx: ContractTransaction): Promise<number> => {
  const receipt = await tx.wait();
  const event = receipt?.events?.filter((x) => {
    return x.event == "AddActionsV2";
  })[0].args;
  return event?.actions[0].actionId;
};

export const getActionChoiceId = async (tx: ContractTransaction): Promise<number> => {
  const receipt = await tx.wait();
  const event = receipt?.events?.filter((x) => {
    return x.event == "AddActionChoicesV2";
  })[0].args;
  return event?.actionChoiceIds[0];
};

export const getActionChoiceIds = async (tx: ContractTransaction): Promise<number[]> => {
  const receipt = await tx.wait();
  const event = receipt?.events?.filter((x) => {
    return x.event == "AddActionChoicesV2";
  })[0].args;
  return event?.actionChoiceIds;
};

export const bronzeHelmetStats: EstforTypes.CombatStats = {
  melee: 1,
  magic: 0,
  ranged: 0,
  meleeDefence: 4,
  magicDefence: 0,
  rangedDefence: 1,
  health: 1,
};

// Should match the PlayersBase contract constants
export const MAX_TIME = 86400; // 1 day
export const START_XP = 374;
// 90%, used for actions/actionChoices which can have a failure rate like thieving/cooking
export const MAX_SUCCESS_PERCENT_CHANCE = 90;
export const MAX_UNIQUE_TICKETS = 64;

export const SPAWN_MUL = 1000;
export const RATE_MUL = 1000;
export const GUAR_MUL = 10;
