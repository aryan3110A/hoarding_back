import { BadRequestError } from '../lib/errors';
import { ClientRepository, ClientCreateInput } from '../repositories/client.repository';

export type ClientInput = {
  name: string;
  phone: string;
  email?: string;
  companyName?: string;
};

export class ClientService {
  private repo: ClientRepository;

  constructor() {
    this.repo = new ClientRepository();
  }

  private normalizePhone(phone: string): string {
    return String(phone || '')
      .replace(/\s+/g, '')
      .trim();
  }

  async findOrCreate(
    input: ClientInput,
    createdBy?: string,
  ): Promise<{ id: string; name: string; phone: string } & Record<string, unknown>> {
    const name = String(input.name || '').trim();
    const phone = this.normalizePhone(input.phone);
    const email = input.email ? String(input.email).trim() : undefined;
    const companyName = input.companyName ? String(input.companyName).trim() : undefined;

    if (!name) throw new BadRequestError('Client name is required');
    if (!phone) throw new BadRequestError('Client phone is required');

    const existingUnknown = await this.repo.findByPhone(phone);
    const existing = existingUnknown as
      | null
      | ({
          id: string;
          name: string;
          phone: string;
          email?: string | null;
          companyName?: string | null;
        } & Record<string, unknown>);

    if (existing) {
      // Optionally enrich missing fields without overwriting existing values.
      const patch: Record<string, unknown> = {};
      if (name && (!existing.name || String(existing.name).trim().length === 0)) patch.name = name;
      if (email && (!existing.email || String(existing.email).trim().length === 0))
        patch.email = email;
      if (
        companyName &&
        (!existing.companyName || String(existing.companyName).trim().length === 0)
      )
        patch.companyName = companyName;

      if (Object.keys(patch).length > 0) {
        await this.repo.update(existing.id, patch as any);
      }

      return { ...existing, name: existing.name || name, phone: existing.phone || phone };
    }

    const createdUnknown = await this.repo.create({
      name,
      phone,
      email: email || null,
      companyName: companyName || null,
      createdById: createdBy || null,
    } as ClientCreateInput);

    const created = createdUnknown as { id: string; name: string; phone: string } & Record<
      string,
      unknown
    >;
    return created;
  }
}
