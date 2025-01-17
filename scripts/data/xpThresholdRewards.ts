import {EstforConstants, EstforTypes} from "@paintswap/estfor-definitions";

export type XPThresholdReward = {
  xpThreshold: number;
  rewards: EstforTypes.Equipment[];
};

export const allXPThresholdRewards: XPThresholdReward[] = [
  {
    xpThreshold: 500,
    rewards: [
      {
        itemTokenId: EstforConstants.EMERALD_STAFF,
        amount: 1,
      },
    ],
  },
  {
    xpThreshold: 1000,
    rewards: [
      {
        itemTokenId: EstforConstants.XP_BOOST,
        amount: 1,
      },
    ],
  },
  {
    xpThreshold: 2500,
    rewards: [
      {
        itemTokenId: EstforConstants.GATHERING_BOOST,
        amount: 1,
      },
    ],
  },
  {
    xpThreshold: 5000,
    rewards: [
      {
        itemTokenId: EstforConstants.COOKED_SKRIMP,
        amount: 20,
      },
    ],
  },
  {
    xpThreshold: 10000,
    rewards: [
      {
        itemTokenId: EstforConstants.WHITE_DEATH_SPORE,
        amount: 10,
      },
    ],
  },
  {
    xpThreshold: 30000,
    rewards: [
      {
        itemTokenId: EstforConstants.ASH_LOG,
        amount: 20,
      },
    ],
  },
  {
    xpThreshold: 50000,
    rewards: [
      {
        itemTokenId: EstforConstants.BONE_KEY,
        amount: 3,
      },
    ],
  },
  {
    xpThreshold: 100000,
    rewards: [
      {
        itemTokenId: EstforConstants.AQUA_KEY,
        amount: 3,
      },
    ],
  },
  {
    xpThreshold: 120000,
    rewards: [
      {
        itemTokenId: EstforConstants.DRAGON_BONE,
        amount: 50,
      },
    ],
  },
  {
    xpThreshold: 300000,
    rewards: [
      {
        itemTokenId: EstforConstants.SKILL_BOOST,
        amount: 3,
      },
    ],
  },
  {
    xpThreshold: 350000,
    rewards: [
      {
        itemTokenId: EstforConstants.XP_BOOST,
        amount: 3,
      },
    ],
  },
  {
    xpThreshold: 500000,
    rewards: [
      {
        itemTokenId: EstforConstants.GATHERING_BOOST,
        amount: 4,
      },
    ],
  },
  {
    xpThreshold: 600000,
    rewards: [
      {
        itemTokenId: EstforConstants.COMBAT_BOOST,
        amount: 5,
      },
    ],
  },
  {
    xpThreshold: 750000,
    rewards: [
      {
        itemTokenId: EstforConstants.LOSSUTH_SCALE,
        amount: 5,
      },
    ],
  },
  {
    xpThreshold: 900000,
    rewards: [
      {
        itemTokenId: EstforConstants.TITANIUM_BAR,
        amount: 1200,
      },
    ],
  },
  {
    xpThreshold: 1000000,
    rewards: [
      {
        itemTokenId: EstforConstants.NATURE_SCROLL,
        amount: 5000,
      },
    ],
  },
  {
    xpThreshold: 1200000,
    rewards: [
      {
        itemTokenId: EstforConstants.WHITE_DEATH_SPORE,
        amount: 100,
      },
    ],
  },
  {
    xpThreshold: 1500000,
    rewards: [
      {
        itemTokenId: EstforConstants.COOKED_DOUBTFISH,
        amount: 250,
      },
    ],
  },
  {
    xpThreshold: 1800000,
    rewards: [
      {
        itemTokenId: EstforConstants.COOKED_ROSEFIN,
        amount: 500,
      },
    ],
  },
  {
    xpThreshold: 2000000,
    rewards: [
      {
        itemTokenId: EstforConstants.XP_BOOST,
        amount: 10,
      },
    ],
  },
  {
    xpThreshold: 2500000,
    rewards: [
      {
        itemTokenId: EstforConstants.SKILL_BOOST,
        amount: 10,
      },
    ],
  },
  {
    xpThreshold: 2700000,
    rewards: [
      {
        itemTokenId: EstforConstants.GATHERING_BOOST,
        amount: 10,
      },
    ],
  },
  {
    xpThreshold: 3000000,
    rewards: [
      {
        itemTokenId: EstforConstants.COMBAT_BOOST,
        amount: 10,
      },
    ],
  },
];
