import Razorpay from 'razorpay';

export function createRazorpayGateway({ getKeyId, getKeySecret }) {
  function client() {
    return new Razorpay({ key_id: getKeyId(), key_secret: getKeySecret() });
  }

  return {
    getPublicKeyId: () => getKeyId(),
    createOrder: (order) => client().orders.create(order),
    async findOrderByReceipt(receipt) {
      const result = await client().orders.all({ receipt, count: 10 });
      return result.items?.find((order) => order.receipt === receipt) ?? null;
    },
    fetchPayment: (paymentId) => client().payments.fetch(paymentId),
    fetchOrder: (orderId) => client().orders.fetch(orderId),
    fetchPaymentsForOrder: (orderId) => client().orders.fetchPayments(orderId),
  };
}
