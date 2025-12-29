import PDFDocument from 'pdfkit';
import getStream from 'get-stream';
import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';

interface HoardingRow {
  id: string;
  code?: string | null;
  city?: string | null;
  area?: string | null;
  landmark?: string | null;
  widthCm?: number | null;
  heightCm?: number | null;
  type?: string | null;
  status?: string | null;
}

export class ProposalsService {
  async generateProposalPdf(opts: {
    hoardingIds: string[];
    client?: {
      name?: string | null;
      phone?: string | null;
      email?: string | null;
      companyName?: string | null;
      address?: string | null;
    };
    actorId?: string;
  }): Promise<Buffer> {
    const { hoardingIds, client } = opts;

    // fetch hoardings
    const hoardings: HoardingRow[] = await prisma.hoarding.findMany({
      where: { id: { in: hoardingIds } },
      select: {
        id: true,
        code: true,
        city: true,
        area: true,
        landmark: true,
        widthCm: true,
        heightCm: true,
        type: true,
        status: true,
      },
    });

    const doc = new PDFDocument({ autoFirstPage: false });

    // Cover page with client details
    doc.addPage({ size: 'A4', margin: 48 });
    doc.fontSize(22).text('Hoarding Proposal', { align: 'center' });
    doc.moveDown(1.5);
    if (client) {
      doc.fontSize(12).text(`Client Name: ${client.name || '—'}`);
      doc.moveDown(0.2);
      if (client.phone) doc.text(`Phone: ${client.phone}`);
      if (client.email) doc.text(`Email: ${client.email}`);
      if (client.companyName) doc.text(`Company: ${client.companyName}`);
      if (client.address) doc.text(`Address: ${client.address}`);
    }
    doc.moveDown(1);
    doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`);

    // Table layout: up to 10 hoardings per page with dynamic heights
    const rowsPerPage = 10;
    const colWidths: Record<string, number> = {
      code: 100,
      city: 110,
      location: 230,
      size: 70,
      type: 70,
      status: 90,
    };

    // ensure table fits page width; scale columns if needed
    const pageContentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    let tableTotalWidth = Object.values(colWidths).reduce((a: number, b: number) => a + b, 0);
    if (tableTotalWidth > pageContentWidth) {
      const scale = pageContentWidth / tableTotalWidth;
      Object.keys(colWidths).forEach((k) => {
        colWidths[k] = Math.floor(colWidths[k] * scale);
      });
      tableTotalWidth = Object.values(colWidths).reduce((a: number, b: number) => a + b, 0);
    }

    const chunks: HoardingRow[][] = [];
    for (let i = 0; i < hoardings.length; i += rowsPerPage) {
      chunks.push(hoardings.slice(i, i + rowsPerPage));
    }

    for (const pageRows of chunks) {
      doc.addPage({ size: 'A4', margin: 48 });

      const tableStartX = doc.page.margins.left;
      const headerY = doc.y;

      // header height based on font size
      const headerHeight = Math.max(
        20,
        doc.heightOfString('Location / Area', { width: colWidths.location - 12 }) + 12,
      );

      // draw header background
      doc.save();
      const docWithRounded = doc as unknown as {
        roundedRect?: (
          x: number,
          y: number,
          w: number,
          h: number,
          r: number,
        ) => InstanceType<typeof PDFDocument>;
      };
      if (typeof docWithRounded.roundedRect === 'function') {
        docWithRounded
          .roundedRect(tableStartX, headerY, tableTotalWidth, headerHeight, 4)
          .fill('#f8fafc');
      } else {
        doc.rect(tableStartX, headerY, tableTotalWidth, headerHeight).fill('#f8fafc');
      }
      doc.fillColor('#000');
      doc.fontSize(11).font('Helvetica-Bold');

      // render header titles
      let curX = tableStartX;
      doc.text('Code', curX + 6, headerY + 6, { width: colWidths.code - 12 });
      curX += colWidths.code;
      doc.text('City', curX + 6, headerY + 6, { width: colWidths.city - 12 });
      curX += colWidths.city;
      doc.text('Location / Area', curX + 6, headerY + 6, { width: colWidths.location - 12 });
      curX += colWidths.location;
      doc.text('Size', curX + 6, headerY + 6, { width: colWidths.size - 12 });
      curX += colWidths.size;
      doc.text('Type', curX + 6, headerY + 6, { width: colWidths.type - 12 });
      curX += colWidths.type;
      doc.text('Status', curX + 6, headerY + 6, { width: colWidths.status - 12 });

      // header separator
      doc
        .moveTo(tableStartX, headerY + headerHeight)
        .lineTo(tableStartX + tableTotalWidth, headerY + headerHeight)
        .lineWidth(0.6)
        .strokeColor('#e2e8f0')
        .stroke();

      // start rows below header
      let currentY = headerY + headerHeight + 6;
      doc.fontSize(10).font('Helvetica');

      // draw each row with computed height to avoid overlap
      for (const h of pageRows) {
        const sizeText =
          h.widthCm && h.heightCm
            ? `${Math.round(h.widthCm / 30.48)}ft x ${Math.round(h.heightCm / 30.48)}ft`
            : '—';
        const locationText = [h.city, h.area, h.landmark].filter(Boolean).join(', ');

        // compute heights for each cell to determine row height
        const heights: number[] = [];
        heights.push(doc.heightOfString(h.code || '—', { width: colWidths.code - 12 }));
        heights.push(doc.heightOfString(h.city || '—', { width: colWidths.city - 12 }));
        heights.push(doc.heightOfString(locationText || '—', { width: colWidths.location - 12 }));
        heights.push(doc.heightOfString(sizeText, { width: colWidths.size - 12 }));
        heights.push(doc.heightOfString(h.type || '—', { width: colWidths.type - 12 }));
        heights.push(doc.heightOfString(h.status || '—', { width: colWidths.status - 12 }));

        const contentHeight = Math.max(...heights);
        const rowHeight = Math.max(18, Math.ceil(contentHeight) + 8);

        // render cells
        curX = tableStartX;
        doc.fillColor('#000');
        doc.text(h.code || '—', curX + 6, currentY + 4, { width: colWidths.code - 12 });
        curX += colWidths.code;
        doc.text(h.city || '—', curX + 6, currentY + 4, { width: colWidths.city - 12 });
        curX += colWidths.city;
        doc.text(locationText || '—', curX + 6, currentY + 4, { width: colWidths.location - 12 });
        curX += colWidths.location;
        doc.text(sizeText, curX + 6, currentY + 4, { width: colWidths.size - 12 });
        curX += colWidths.size;
        doc.text(h.type || '—', curX + 6, currentY + 4, { width: colWidths.type - 12 });
        curX += colWidths.type;
        doc.text(h.status || '—', curX + 6, currentY + 4, { width: colWidths.status - 12 });

        // separator
        doc
          .moveTo(tableStartX, currentY + rowHeight)
          .lineTo(tableStartX + tableTotalWidth, currentY + rowHeight)
          .lineWidth(0.4)
          .strokeColor('#eef3f7')
          .stroke();

        currentY += rowHeight;
      }

      // draw outer border
      const tableHeight = currentY - headerY;
      doc
        .lineWidth(0.6)
        .strokeColor('#e2e8f0')
        .rect(tableStartX, headerY, tableTotalWidth, tableHeight)
        .stroke();
      doc.restore();
    }

    doc.end();
    const buffer = await getStream.buffer(doc as unknown as NodeJS.ReadableStream);
    return buffer;
  }

  async createProposal(input: {
    client: { name: string; phone: string; email?: string; companyName?: string };
    hoardingIds: string[];
    salesUserId: string;
  }) {
    const clientData = input.client;

    // find or create client by phone
    let client = await prisma.client.findUnique({ where: { phone: clientData.phone } });
    if (!client) {
      client = await prisma.client.create({
        data: {
          name: clientData.name,
          phone: clientData.phone,
          email: clientData.email || null,
          companyName: clientData.companyName || null,
          createdById: input.salesUserId,
        },
      });
    }

    const proposal = await prisma.proposal.create({
      data: {
        clientId: client.id,
        salesUserId: input.salesUserId,
      },
    });

    // create proposal hoarding links
    for (const hid of input.hoardingIds) {
      await prisma.proposalHoarding.create({
        data: { proposalId: proposal.id, hoardingId: hid },
      });
    }

    return await prisma.proposal.findUnique({
      where: { id: proposal.id },
      include: { hoardings: true, client: true },
    });
  }

  async listProposals(filter?: { salesUserId?: string }) {
    const where: Prisma.ProposalWhereInput = {};
    if (filter?.salesUserId) where.salesUserId = filter.salesUserId;
    return prisma.proposal.findMany({
      where,
      include: { client: true, hoardings: { include: { hoarding: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getProposalById(id: string) {
    return prisma.proposal.findUnique({
      where: { id },
      include: { client: true, hoardings: { include: { hoarding: true } }, salesUser: true },
    });
  }
}
