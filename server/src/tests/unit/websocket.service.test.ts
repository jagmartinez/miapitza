import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { WebSocketService } from '../../services/websocket.service';
import jwt from 'jsonwebtoken';
import prisma from '../../utils/prisma';
import { SessionService } from '../../services/session.service';

type MockClient = {
    readyState: number;
    send: jest.Mock;
    authenticated?: boolean;
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
    jest.restoreAllMocks();
  });

  it('filters messages by company and branch', () => {
    const clientA = { readyState: 1, send: jest.fn(), authenticated: true, companyId: 10, branchId: 2, roles: ['ADMIN'] };
    const clientB = { readyState: 1, send: jest.fn(), authenticated: true, companyId: 10, branchId: 3, roles: ['ADMIN'] };
    const clientC = { readyState: 1, send: jest.fn(), authenticated: true, companyId: 11, branchId: 2, roles: ['ADMIN'] };

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
    const kitchenClient = { readyState: 1, send: jest.fn(), authenticated: true, companyId: 10, branchId: 2, roles: ['CHEF'] };
    const waiterClient = { readyState: 1, send: jest.fn(), authenticated: true, companyId: 10, branchId: 2, roles: ['MESERO'] };

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

  it('blocks broadcasts without an explicit tenant scope', () => {
    const client = { readyState: 1, send: jest.fn(), authenticated: true, companyId: 10, branchId: 2, roles: ['ADMIN'] };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (WebSocketService as unknown as WebSocketServiceTestAccess).clients = new Map([['a', client]]);

    WebSocketService.broadcast({ type: 'ORDER_UPDATE', payload: { id: 1 } });

    expect(client.send).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Blocked unscoped broadcast'));
  });

  it('rejects unauthenticated clients even if stale scope fields are present', () => {
    const client = { readyState: 1, send: jest.fn(), authenticated: false, companyId: 10, branchId: 2, roles: ['ADMIN'] };
    (WebSocketService as unknown as WebSocketServiceTestAccess).clients = new Map([['a', client]]);

    WebSocketService.broadcast({ type: 'ORDER_UPDATE', payload: { id: 1 } }, { companyId: 10, branchId: 2 });

    expect(client.send).not.toHaveBeenCalled();
  });
});

describe('WebSocketService authentication scope', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('uses the current database tenant, branch and roles instead of stale JWT claims', async () => {
    jest.spyOn(jwt, 'verify').mockReturnValue({ userId: 7, companyId: 999, branchId: 999, roles: ['SUPERADMIN'] } as never);
    jest.spyOn(SessionService, 'isValid').mockResolvedValue(true);
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
      id: 7,
      companyId: 10,
      branchId: 2,
      status: 'ACTIVE',
      mustChangePassword: false,
      company: { active: true },
      branch: { status: 'ACTIVE' },
      allowedBranches: [],
      role: { name: 'CAJERO' },
      userRoles: []
    } as never);
    const client: Record<string, unknown> = {};
    const authenticate = (WebSocketService as unknown as {
      authenticateClient(target: Record<string, unknown>, token: string): Promise<boolean>;
    }).authenticateClient.bind(WebSocketService);
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'test-secret';
    try {
      await expect(authenticate(client, 'signed-token')).resolves.toBe(true);
      expect(client).toEqual(expect.objectContaining({
        userId: 7, companyId: 10, branchId: 2, roles: ['CAJERO'], authenticated: true
      }));
    } finally {
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
  });

  it('rejects a session whose user is now inactive', async () => {
    jest.spyOn(jwt, 'verify').mockReturnValue({ userId: 7 } as never);
    jest.spyOn(SessionService, 'isValid').mockResolvedValue(true);
    jest.spyOn(prisma.user, 'findUnique').mockResolvedValue({
      id: 7, companyId: 10, branchId: 2, status: 'INACTIVE', mustChangePassword: false,
      company: { active: true }, branch: { status: 'ACTIVE' }, role: { name: 'CAJERO' }, userRoles: [],
      allowedBranches: []
    } as never);
    const authenticate = (WebSocketService as unknown as {
      authenticateClient(target: Record<string, unknown>, token: string): Promise<boolean>;
    }).authenticateClient.bind(WebSocketService);
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'test-secret';
    try {
      await expect(authenticate({}, 'signed-token')).resolves.toBe(false);
    } finally {
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
  });
});
