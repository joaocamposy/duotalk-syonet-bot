import { describe, it, expect } from 'vitest';
import { parsePhoneNumber } from '../../src/utils/phone-parser.js';

describe('phoneParser Utility', () => {
  it('deve extrair DDI (55), DDD (61) e Número (993351327) de payload completo com 13 dígitos', () => {
    const result = parsePhoneNumber('5561993351327');
    expect(result.ddi).toBe('55');
    expect(result.ddd).toBe('61');
    expect(result.number).toBe('993351327');
    expect(result.fullWithoutDdi).toBe('61993351327');
    expect(result.formattedWithHyphen).toBe('99335-1327');
  });

  it('deve extrair DDD e Número de formato com 11 dígitos sem DDI', () => {
    const result = parsePhoneNumber('61993351327');
    expect(result.ddd).toBe('61');
    expect(result.number).toBe('993351327');
    expect(result.formattedWithHyphen).toBe('99335-1327');
  });

  it('deve formatar números fixos de 8 dígitos com hífen', () => {
    const result = parsePhoneNumber('556133445566');
    expect(result.ddd).toBe('61');
    expect(result.number).toBe('33445566');
    expect(result.formattedWithHyphen).toBe('3344-5566');
  });

  it('deve limpar caracteres não numéricos como parênteses e hífens', () => {
    const result = parsePhoneNumber('+55 (61) 99335-1327');
    expect(result.ddd).toBe('61');
    expect(result.number).toBe('993351327');
  });

  it('deve lançar erro se o telefone for nulo ou vazio', () => {
    expect(() => parsePhoneNumber('')).toThrow('Telefone não fornecido');
  });
});
