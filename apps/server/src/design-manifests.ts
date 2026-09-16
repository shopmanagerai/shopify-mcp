/**
 * Adapts storage's DesignManifestRepo to the @shopmanagerai/tools
 * DesignManifestService interface expected under ctx.services.get("designManifests").
 */
import { newId, type DesignManifest } from "@shopmanagerai/shared";
import type { DesignManifestRepo } from "@shopmanagerai/storage";
import type { DesignManifestRecord, DesignManifestService } from "@shopmanagerai/tools";

export class SqliteDesignManifestService implements DesignManifestService {
  constructor(private readonly repo: DesignManifestRepo) {}

  async list(shopId: string): Promise<DesignManifestRecord[]> {
    const rows = await this.repo.list(shopId);
    return rows.map(toRecord);
  }

  async get(manifestId: string): Promise<DesignManifestRecord | null> {
    const row = await this.repo.get(manifestId);
    return row ? toRecord(row) : null;
  }

  async getActive(shopId: string): Promise<DesignManifestRecord | null> {
    const row = await this.repo.getActive(shopId);
    return row ? toRecord(row) : null;
  }

  async create(input: {
    shopId: string;
    name: string;
    manifest: DesignManifest;
    source: "extracted" | "authored";
    createdBy: string;
    activate?: boolean;
  }): Promise<DesignManifestRecord> {
    const row = await this.repo.create({
      manifestId: newId("dm"),
      shopId: input.shopId,
      name: input.name,
      manifest: input.manifest as Record<string, unknown>,
      source: input.source,
      createdBy: input.createdBy,
      activate: input.activate,
    });
    return toRecord(row);
  }

  async setActive(shopId: string, manifestId: string): Promise<void> {
    await this.repo.setActive(shopId, manifestId);
  }

  async delete(manifestId: string): Promise<void> {
    await this.repo.delete(manifestId);
  }
}

function toRecord(row: {
  manifestId: string;
  shopId: string;
  version: number;
  name: string;
  manifest: Record<string, unknown>;
  source: "extracted" | "authored";
  createdBy: string;
  createdAt: string;
  isActive: boolean;
}): DesignManifestRecord {
  return { ...row, manifest: row.manifest as DesignManifest };
}
