import { OrderStatus, ProductType } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { generateOrderCode } from '../../utils/ids';

/**
 * Buat order baru dengan orderCode unik (retry jika collision, walau sangat jarang terjadi).
 */
export async function createRobuxOrder(params: {
  discordId: string;
  robloxUsername: string;
  robuxAmount: number;
  price: number;
}) {
  // Pastikan User ada di database (upsert)
  await prisma.user.upsert({
    where: { discordId: params.discordId },
    update: { robloxUsername: params.robloxUsername },
    create: { discordId: params.discordId, robloxUsername: params.robloxUsername },
  });

  let attempt = 0;
  while (attempt < 5) {
    const orderCode = generateOrderCode();
    try {
      const order = await prisma.order.create({
        data: {
          orderCode,
          discordId: params.discordId,
          productType: ProductType.ROBUX,
          robloxUsername: params.robloxUsername,
          robuxAmount: params.robuxAmount,
          price: params.price,
          status: OrderStatus.PENDING,
        },
      });
      return order;
    } catch (err: any) {
      // Kemungkinan unique constraint collision pada orderCode - coba lagi
      if (err?.code === 'P2002') {
        attempt++;
        continue;
      }
      throw err;
    }
  }
  throw new Error('Gagal membuat order setelah beberapa percobaan (orderCode collision).');
}

export async function getOrderById(orderId: string) {
  return prisma.order.findUnique({ where: { id: orderId } });
}

export async function getOrderByTicketChannel(channelId: string) {
  return prisma.order.findUnique({ where: { ticketChannelId: channelId } });
}

export async function attachTicketChannel(orderId: string, channelId: string) {
  return prisma.order.update({
    where: { id: orderId },
    data: { ticketChannelId: channelId, status: OrderStatus.WAITING_PAYMENT },
  });
}

export async function setPaymentProof(orderId: string, proofUrl: string) {
  return prisma.order.update({
    where: { id: orderId },
    data: { paymentProofUrl: proofUrl },
  });
}

export async function verifyPayment(orderId: string, staffId: string) {
  return prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.PAID, paidAt: new Date(), verifiedBy: staffId },
  });
}

/**
 * Tolak bukti pembayaran. Order dikembalikan ke WAITING_PAYMENT (bukan status terminal)
 * supaya customer bisa upload ulang bukti yang benar.
 */
export async function rejectPayment(orderId: string, staffId: string, reason?: string) {
  return prisma.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.WAITING_PAYMENT,
      verifiedBy: staffId,
      rejectedReason: reason,
      paymentProofUrl: null,
    },
  });
}

export async function markProcessing(orderId: string) {
  return prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.PROCESSING } });
}

export async function markCompleted(orderId: string) {
  return prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.COMPLETED, completedAt: new Date() },
  });
}

export async function cancelOrder(orderId: string) {
  return prisma.order.update({
    where: { id: orderId },
    data: { status: OrderStatus.CANCELLED, cancelledAt: new Date() },
  });
}

export async function getUserOrderHistory(discordId: string, limit = 10) {
  return prisma.order.findMany({
    where: { discordId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export function isOrderActive(status: OrderStatus): boolean {
  return ([
    OrderStatus.PENDING,
    OrderStatus.WAITING_PAYMENT,
    OrderStatus.PAID,
    OrderStatus.PROCESSING,
  ] as OrderStatus[]).includes(status);
}

/**
 * Cek apakah user sudah punya order aktif (anti-spam ticket).
 */
export async function getActiveOrderForUser(discordId: string) {
  return prisma.order.findFirst({
    where: {
      discordId,
      status: { in: [OrderStatus.PENDING, OrderStatus.WAITING_PAYMENT, OrderStatus.PAID, OrderStatus.PROCESSING] },
    },
  });
}
