import type { Chain } from "./app";
import { createWalletClient, createPublicClient, http } from "viem";
import { monadTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Jejak onchain AgentPay.sol. Stub default (tanpa network) agar test & dev
 * berjalan offline. Mode nyata aktif hanya kalau semua env chain terisi.
 * ponytail: ABI minimal + read/write langsung; tanpa address → catch di app.ts.
 */
export const createChain = (opts: {
  rpcUrl?: string;
  deployerKey?: string;
  contractAddress?: string;
} = {}): Chain => {
  // default: baca env (untuk prod). test memanggil dengan opts explicit atau stub.
  const rpcUrl = opts.rpcUrl ?? process.env.MONAD_RPC_URL;
  const deployerKey = opts.deployerKey ?? process.env.DEPLOYER_PRIVKEY;
  const contractAddress = opts.contractAddress ?? process.env.AGENTPAY_ADDRESS;
  const ready = rpcUrl && deployerKey && contractAddress;
  if (!ready) {
    let next = 0;
    return {
      createTask: async (_poster, _budgetUsd) => ({ taskId: ++next, tx: "0xstub" }),
      claimTask: async () => ({ tx: "0xstub" }),
      setApproved: async () => ({ tx: "0xstub" }),
      recordPayment: async () => ({ tx: "0xstub" }),
    };
  }

  // mode nyata: viem
  const normalize = (k: string) => ("0x" + k.replace(/^0x/, "")) as `0x${string}`;
  const wallet = createWalletClient({
    account: privateKeyToAccount(normalize(deployerKey as string)),
    chain: monadTestnet,
    transport: http(rpcUrl),
  });
  const publicClient = createPublicClient({ chain: monadTestnet, transport: http(rpcUrl) });
  const address = contractAddress as `0x${string}`;
  const send = async (tx: Promise<`0x${string}`>) => {
    const hash = await tx;
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  };

  return {
    createTask: async (poster, budgetUsd) => {
      const id = await publicClient.readContract({
        address,
        abi: taskCountAbi,
        functionName: "taskCount",
      });
      const tx = await send(
        wallet.writeContract({
          address,
          abi: createTaskAbi,
          functionName: "createTask",
          args: [poster as `0x${string}`, BigInt(Math.round(budgetUsd * 1e6))],
        }),
      );
      return { taskId: Number(id), tx };
    },
    claimTask: async (taskId, worker) => {
      const tx = await send(
        wallet.writeContract({
          address,
          abi: claimTaskAbi,
          functionName: "claimTask",
          args: [BigInt(taskId), worker as `0x${string}`],
        }),
      );
      return { tx };
    },
    setApproved: async (taskId, rejected) => {
      const fn = rejected ? "rejectTask" : "approveTask";
      const tx = await send(
        wallet.writeContract({
          address,
          abi: rejectApproveAbi,
          functionName: fn,
          args: [BigInt(taskId)],
        }),
      );
      return { tx };
    },
    recordPayment: async (taskId, hash) => {
      const bytes32 = ("0x" + (hash as string).replace(/^0x/, "")).padEnd(66, "0") as `0x${string}`;
      const tx = await send(
        wallet.writeContract({
          address,
          abi: recordPaymentAbi,
          functionName: "recordPayment",
          args: [BigInt(taskId), bytes32],
        }),
      );
      return { tx };
    },
  };
};

const claimTaskAbi = [
  {
    type: "function",
    name: "claimTask",
    inputs: [
      { name: "id", type: "uint64" },
      { name: "worker", type: "address" },
    ],
    stateMutability: "nonpayable",
  },
] as const;

const rejectApproveAbi = [
  {
    type: "function",
    name: "approveTask",
    inputs: [{ name: "id", type: "uint64" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "rejectTask",
    inputs: [{ name: "id", type: "uint64" }],
    stateMutability: "nonpayable",
  },
] as const;

const taskCountAbi = [
  {
    type: "function",
    name: "taskCount",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
    stateMutability: "view",
  },
] as const;

const createTaskAbi = [
  {
    type: "function",
    name: "createTask",
    inputs: [
      { name: "poster", type: "address" },
      { name: "budget", type: "uint256" },
    ],
    outputs: [{ name: "id", type: "uint64" }],
    stateMutability: "nonpayable",
  },
] as const;

const recordPaymentAbi = [
  {
    type: "function",
    name: "recordPayment",
    inputs: [
      { name: "id", type: "uint64" },
      { name: "submissionHash", type: "bytes32" },
    ],
    stateMutability: "nonpayable",
  },
] as const;

export const makeChain = createChain;

// balance USDC onchain (untuk /balance/:addr frontend). null bila tidak siap.
export const usdcBalanceOf = async (address: string): Promise<string | null> => {
  const rpc = process.env.MONAD_RPC_URL;
  const usdc = process.env.USDC_TEST_ADDRESS;
  if (!rpc || !usdc) return null;
  try {
    const pub = createPublicClient({ chain: monadTestnet, transport: http(rpc) });
    const b = await pub.readContract({
      address: usdc as `0x${string}`,
      abi: balanceOfAbi,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    });
    return b.toString();
  } catch {
    return null;
  }
};

const balanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;