import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loginAndGetCookiesViaHttp } from '../../src/integrations/syonet/auth-service.js';

const { publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

describe('loginAndGetCookiesViaHttp', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falha antes da rede quando as credenciais não estão configuradas', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      loginAndGetCookiesViaHttp('https://crm.example.com/portal/acessaSistema.do', '', ''),
    ).rejects.toThrow('Credenciais do Syonet não configuradas');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('autentica e valida a sessão usando apenas HTTP', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', {
          status: 200,
          headers: { 'set-cookie': 'JSESSIONID=initial; Path=/portal' },
        }),
      )
      .mockResolvedValueOnce(Response.json({ valor: publicKey }, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: '/portal/acessaSistema.do',
            'set-cookie': 'JSESSIONID=authenticated; Path=/portal, RSESSIONID=route; Path=/',
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ idUsuario: 1671 }, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const cookieHeader = await loginAndGetCookiesViaHttp(
      'https://crm.example.com/portal/acessaSistema.do',
      'usuario.teste',
      'senha-secreta',
    );

    expect(cookieHeader).toBe('JSESSIONID=authenticated; RSESSIONID=route');
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const loginRequest = fetchMock.mock.calls[2];
    const loginOptions = loginRequest[1] as RequestInit;
    expect(loginRequest[0]).toBe(
      'https://crm.example.com/portal/validarLogonUsuario.do?opcaoAtualizacao',
    );
    expect(loginOptions.method).toBe('POST');
    expect(loginOptions.body).not.toContain('usuario.teste');
    expect(loginOptions.body).not.toContain('senha-secreta');
  });

  it('recusa a autenticação quando o portal não redireciona após o login', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', {
          status: 200,
          headers: { 'set-cookie': 'JSESSIONID=initial; Path=/portal' },
        }),
      )
      .mockResolvedValueOnce(Response.json({ valor: publicKey }, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ msg: 'Login inválido' }, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = loginAndGetCookiesViaHttp(
      'https://crm.example.com/portal/acessaSistema.do',
      'usuario.teste',
      'senha-incorreta',
    );

    await expect(result).rejects.toEqual(
      expect.objectContaining({
        name: 'NonRetryableJobError',
        message: 'Login HTTP recusado pelo Syonet: HTTP 200',
      }),
    );
  });

  it('recusa resposta 200 que não confirme um usuário autenticado', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('', {
          status: 200,
          headers: { 'set-cookie': 'JSESSIONID=initial; Path=/portal' },
        }),
      )
      .mockResolvedValueOnce(Response.json({ valor: publicKey }, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { 'set-cookie': 'JSESSIONID=authenticated; Path=/portal' },
        }),
      )
      .mockResolvedValueOnce(new Response('<html>login</html>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      loginAndGetCookiesViaHttp(
        'https://crm.example.com/portal/acessaSistema.do',
        'usuario.teste',
        'senha',
      ),
    ).rejects.toThrow('conteúdo inválido');
  });
});
