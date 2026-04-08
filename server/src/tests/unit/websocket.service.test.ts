import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { WebSocketService } from '../../services/websocket.service';

type MockClient = {
    readyState: number;
    send: jest.Mock;
    companyId?: number;
    branchId?: number;
    roles?: string[];
};

type WebSocketServiceTestAccess = {
    clients: Map<string, MockClient>;
};

function getWsClientsMap(): Map<string, MockClient> {
    return (WebSocketService as unknown as WebSocketServiceTestAccess).clients;
}

describe('WebSocketService.broadcast', () => {
  afterEach(() => {
    getWsClientsMap().clear();
  });

  it('filters messages by company and branch', () => {
    const clientA = { readyState: 1, send: jest.fn(), companyId: 10, branchId: 2, roles: ['ADMIN'] };
    const clientB = { readyState: 1, send: jest.fn(), companyId: 10, branchId: 3, roles: ['ADMIN'] };
    const clientC = { readyState: 1, send: jest.fn(), companyId: 11, branchId: 2, roles: ['ADMIN'] };

    (WebSocketService as unknown as WebSocketServiceTestAccess).clients = new Map([
      ['a', clientA],
      ['b', clientB],
      ['c', clientC],
    ]);

    WebSocketService.broadcast({ type: 'ORDER_UPDATE', payload: { id: 1 } }, { companyId: 10, branchId: 2 });

    expect(clientA.send).toHaveBeenCalledTimes(1);
    expect(clientB.send).not.toHaveBeenCalled();
    expect(clientC.send).not.toHaveBeenCalled();
  });

  it('filters kitchen notifications by roles', () => {
    const kitchenClient = { readyState: 1, send: jest.fn(), companyId: 10, branchId: 2, roles: ['CHEF'] };
    const waiterClient = { readyState: 1, send: jest.fn(), companyId: 10, branchId: 2, roles: ['MESERO'] };

    (WebSocketService as unknown as WebSocketServiceTestAccess).clients = new Map([
      ['kitchen', kitchenClient],
      ['waiter', waiterClient],
    ]);

    WebSocketService.broadcastKitchenNotification({ orderId: 9 }, {
      companyId: 10,
      branchId: 2,
      roles: ['CHEF', 'COCINA'],
    });

    expect(kitchenClient.send).toHaveBeenCalledTimes(1);
    expect(waiterClient.send).not.toHaveBeenCalled();
  });
});
