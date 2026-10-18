const Joi = require('joi');

// Layer 1: only well-formed records are even considered. Names and cities must be
// letters (plus space . ' -), so junk and injection strings are rejected here.
const lettersOnly = /^(?=.*\p{L})[\p{L} .'-]+$/u;

const recordSchema = Joi.object({
  fullName: Joi.string().trim().min(2).max(100).pattern(lettersOnly).required(),
  email: Joi.string().trim().email().max(255).required(),
  phone: Joi.string()
    .trim()
    .allow('', null)
    .custom((value, helpers) => {
      if (!value) return value;
      const digits = value.replace(/\D/g, '');
      if (!/^\+?[0-9 ()-]+$/.test(value) || digits.length < 10 || digits.length > 15) {
        return helpers.error('any.invalid');
      }
      return value;
    }),
  city: Joi.string().trim().min(2).max(60).pattern(lettersOnly).required(),
}).required();

module.exports = { recordSchema };
