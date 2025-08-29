import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface MintRecord {
  projectId: number;
  amount: number;
  recipient: string;
  metadata: string;
  timestamp: number;
  verifier: string;
}

interface VerificationCache {
  verified: boolean;
  data: string;
  timestamp: number;
}

interface ContractState {
  paused: boolean;
  admin: string;
  totalMinted: number;
  mintCounter: number;
  projectMintCaps: Map<number, number>;
  projectMintedAmounts: Map<number, number>;
  mintRecords: Map<number, MintRecord>;
  authorizedMinters: Map<string, boolean>;
  verificationCache: Map<string, VerificationCache>; // Key: `${projectId}-${hash}`
}

// Mock contract implementation
class CreditMinterMock {
  private state: ContractState = {
    paused: false,
    admin: "deployer",
    totalMinted: 0,
    mintCounter: 0,
    projectMintCaps: new Map(),
    projectMintedAmounts: new Map(),
    mintRecords: new Map(),
    authorizedMinters: new Map([["deployer", true]]),
    verificationCache: new Map(),
  };

  private MAX_METADATA_LEN = 500;
  private DEFAULT_MINT_CAP = 1000000;
  private ERR_UNAUTHORIZED = 100;
  private ERR_PAUSED = 101;
  private ERR_INVALID_AMOUNT = 102;
  private ERR_INVALID_RECIPIENT = 103;
  private ERR_VERIFICATION_FAILED = 104;
  private ERR_CAP_EXCEEDED = 105;
  private ERR_INVALID_METADATA = 106;
  private ERR_ALREADY_MINTED = 107; // Reused for add-minter

  private mockBlockHeight = 100;

  private getVerificationKey(projectId: number, verificationHash: string): string {
    return `${projectId}-${verificationHash}`;
  }

  mintCredits(
    caller: string,
    projectId: number,
    amount: number,
    recipient: string,
    metadata: string,
    verificationHash: string
  ): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.state.authorizedMinters.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (recipient === caller) {
      return { ok: false, value: this.ERR_INVALID_RECIPIENT };
    }
    if (metadata.length > this.MAX_METADATA_LEN) {
      return { ok: false, value: this.ERR_INVALID_METADATA };
    }
    const verificationKey = this.getVerificationKey(projectId, verificationHash);
    const cached = this.state.verificationCache.get(verificationKey);
    if (!cached || !cached.verified) {
      return { ok: false, value: this.ERR_VERIFICATION_FAILED };
    }
    const cap = this.state.projectMintCaps.get(projectId) ?? this.DEFAULT_MINT_CAP;
    const currentMinted = this.state.projectMintedAmounts.get(projectId) ?? 0;
    if (currentMinted + amount > cap) {
      return { ok: false, value: this.ERR_CAP_EXCEEDED };
    }
    this.state.projectMintedAmounts.set(projectId, currentMinted + amount);
    this.state.totalMinted += amount;
    const mintId = this.state.mintCounter + 1;
    this.state.mintRecords.set(mintId, {
      projectId,
      amount,
      recipient,
      metadata,
      timestamp: this.mockBlockHeight,
      verifier: caller,
    });
    this.state.mintCounter = mintId;
    return { ok: true, value: true };
  }

  setProjectCap(caller: string, projectId: number, newCap: number): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.projectMintCaps.set(projectId, newCap);
    return { ok: true, value: true };
  }

  addMinter(caller: string, newMinter: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (this.state.authorizedMinters.has(newMinter) && this.state.authorizedMinters.get(newMinter)) {
      return { ok: false, value: this.ERR_ALREADY_MINTED };
    }
    this.state.authorizedMinters.set(newMinter, true);
    return { ok: true, value: true };
  }

  removeMinter(caller: string, minter: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.authorizedMinters.set(minter, false);
    return { ok: true, value: true };
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  cacheVerification(
    caller: string,
    projectId: number,
    verificationHash: string,
    data: string,
    verified: boolean
  ): ClarityResponse<boolean> {
    if (!this.state.authorizedMinters.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const verificationKey = this.getVerificationKey(projectId, verificationHash);
    this.state.verificationCache.set(verificationKey, {
      verified,
      data,
      timestamp: this.mockBlockHeight,
    });
    return { ok: true, value: true };
  }

  getTotalMinted(): ClarityResponse<number> {
    return { ok: true, value: this.state.totalMinted };
  }

  getMintRecord(mintId: number): ClarityResponse<MintRecord | null> {
    return { ok: true, value: this.state.mintRecords.get(mintId) ?? null };
  }

  getProjectMinted(projectId: number): ClarityResponse<number> {
    return { ok: true, value: this.state.projectMintedAmounts.get(projectId) ?? 0 };
  }

  isMinter(account: string): ClarityResponse<boolean> {
    return { ok: true, value: this.state.authorizedMinters.get(account) ?? false };
  }

  isPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.paused };
  }

  getVerificationStatus(projectId: number, verificationHash: string): ClarityResponse<boolean> {
    const verificationKey = this.getVerificationKey(projectId, verificationHash);
    const cached = this.state.verificationCache.get(verificationKey);
    return { ok: true, value: cached ? cached.verified : false };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  minter: "wallet_1",
  user1: "wallet_2",
  user2: "wallet_3",
};

describe("CreditMinter Contract", () => {
  let contract: CreditMinterMock;

  beforeEach(() => {
    contract = new CreditMinterMock();
    vi.resetAllMocks();
  });

  it("should allow admin to add minter", () => {
    const addMinter = contract.addMinter(accounts.deployer, accounts.minter);
    expect(addMinter).toEqual({ ok: true, value: true });

    const isMinter = contract.isMinter(accounts.minter);
    expect(isMinter).toEqual({ ok: true, value: true });
  });

  it("should prevent non-admin from adding minter", () => {
    const addMinter = contract.addMinter(accounts.user1, accounts.minter);
    expect(addMinter).toEqual({ ok: false, value: 100 });
  });

  it("should allow minter to mint credits after verification", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.cacheVerification(accounts.minter, 1, "hash123", "Verified data", true);

    const mintResult = contract.mintCredits(
      accounts.minter,
      1,
      1000,
      accounts.user1,
      "Mangrove restoration project",
      "hash123"
    );
    expect(mintResult).toEqual({ ok: true, value: true });
    expect(contract.getTotalMinted()).toEqual({ ok: true, value: 1000 });
    expect(contract.getProjectMinted(1)).toEqual({ ok: true, value: 1000 });

    const mintRecord = contract.getMintRecord(1);
    expect(mintRecord).toEqual({
      ok: true,
      value: expect.objectContaining({
        projectId: 1,
        amount: 1000,
        recipient: accounts.user1,
        metadata: "Mangrove restoration project",
        verifier: accounts.minter,
      }),
    });
  });

  it("should prevent minting without verification", () => {
    contract.addMinter(accounts.deployer, accounts.minter);

    const mintResult = contract.mintCredits(
      accounts.minter,
      1,
      1000,
      accounts.user1,
      "Unverified",
      "hash123"
    );
    expect(mintResult).toEqual({ ok: false, value: 104 });
  });

  it("should enforce project mint cap", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.cacheVerification(accounts.minter, 1, "hash123", "Verified", true);
    contract.setProjectCap(accounts.deployer, 1, 1500);

    contract.mintCredits(accounts.minter, 1, 1000, accounts.user1, "Project", "hash123");
    const secondMint = contract.mintCredits(accounts.minter, 1, 600, accounts.user1, "Project", "hash123");
    expect(secondMint).toEqual({ ok: false, value: 105 });
  });

  it("should prevent non-minter from caching verification", () => {
    const cacheResult = contract.cacheVerification(accounts.user1, 1, "hash123", "Data", true);
    expect(cacheResult).toEqual({ ok: false, value: 100 });
  });

  it("should pause and unpause contract", () => {
    const pauseResult = contract.pauseContract(accounts.deployer);
    expect(pauseResult).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: true });

    contract.addMinter(accounts.deployer, accounts.minter);
    contract.cacheVerification(accounts.minter, 1, "hash123", "Verified", true);
    const mintDuringPause = contract.mintCredits(
      accounts.minter,
      1,
      1000,
      accounts.user1,
      "Paused",
      "hash123"
    );
    expect(mintDuringPause).toEqual({ ok: false, value: 101 });

    const unpauseResult = contract.unpauseContract(accounts.deployer);
    expect(unpauseResult).toEqual({ ok: true, value: true });
    expect(contract.isPaused()).toEqual({ ok: true, value: false });
  });

  it("should prevent metadata exceeding max length", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.cacheVerification(accounts.minter, 1, "hash123", "Verified", true);

    const longMetadata = "a".repeat(501);
    const mintResult = contract.mintCredits(
      accounts.minter,
      1,
      1000,
      accounts.user1,
      longMetadata,
      "hash123"
    );
    expect(mintResult).toEqual({ ok: false, value: 106 });
  });

  it("should get verification status correctly", () => {
    contract.addMinter(accounts.deployer, accounts.minter);
    contract.cacheVerification(accounts.minter, 1, "hash123", "Verified", true);

    const status = contract.getVerificationStatus(1, "hash123");
    expect(status).toEqual({ ok: true, value: true });

    const invalidStatus = contract.getVerificationStatus(1, "wronghash");
    expect(invalidStatus).toEqual({ ok: true, value: false });
  });
});