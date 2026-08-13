export interface ParsedPhone {
  raw: string;
  digitsOnly: string;
  ddi: string;
  ddd: string;
  number: string;
  fullWithoutDdi: string;
  formattedWithHyphen: string;
}

/**
 * Higieniza o número de telefone extraindo DDI (55), DDD e número do contato.
 * Exemplo: '5561993351327' -> DDI: '55', DDD: '61', Number: '993351327'
 */
export function parsePhoneNumber(phone: string): ParsedPhone {
  if (!phone) {
    throw new Error('Telefone não fornecido');
  }

  // Remove caracteres não numéricos
  const digitsOnly = phone.replace(/\D/g, '');

  let ddi = '55';
  let remaining = digitsOnly;

  // Se o número começa com 55 e possui 12 ou 13 dígitos no total
  if (digitsOnly.startsWith('55') && (digitsOnly.length === 12 || digitsOnly.length === 13)) {
    ddi = '55';
    remaining = digitsOnly.substring(2);
  }

  // DDD possui os primeiros 2 dígitos
  const ddd = remaining.substring(0, 2);
  const number = remaining.substring(2);

  // Formatação com hífen se o número tiver 8 ou 9 dígitos
  let formattedWithHyphen = number;
  if (number.length === 9) {
    formattedWithHyphen = `${number.substring(0, 5)}-${number.substring(5)}`;
  } else if (number.length === 8) {
    formattedWithHyphen = `${number.substring(0, 4)}-${number.substring(4)}`;
  }

  return {
    raw: phone,
    digitsOnly,
    ddi,
    ddd,
    number,
    fullWithoutDdi: `${ddd}${number}`,
    formattedWithHyphen,
  };
}
