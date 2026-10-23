/* Experimental QuotaCell P0. No production custody is authorized.
 * Existing K verifies signatures; existing F forces this type input; existing
 * xUDT validates its token. This file supplies only the missing allowance rule.
 */
#include "ckb_type_id.h"
#include "entry.h"
#include "profile.h"

typedef unsigned __int128 u128;
enum {
  E_STATE = 10,
  E_LINEAGE = 11,
  E_DEPS = 12,
  E_SHAPE = 13,
  E_WITNESS = 14,
  E_AUTH = 15,
  E_TERMS = 16,
  E_DISABLED = 17,
  E_PER_PAYMENT = 18,
  E_PERSONAL = 19,
  E_SHARED = 20,
  E_COUNTER = 21,
  E_TOKEN = 22,
  E_CAPACITY = 23,
  E_ADMIN = 24,
  E_CLOSED = 25,
  E_GENESIS = 26,
  E_OVERFLOW = 27,
  E_RECIPIENT = 28
};
#define REQUIRE(c, e)                                                          \
  do {                                                                         \
    if (!(c))                                                                  \
      return (e);                                                              \
  } while (0)
#define TRY(c)                                                                 \
  do {                                                                         \
    int e_ = (c);                                                              \
    if (e_)                                                                    \
      return e_;                                                               \
  } while (0)
#define STATE_SIZE 466
#define MAX_INPUTS 66
#define MAX_FEE 1000000ULL
static unsigned char old_state[STATE_SIZE], new_state[STATE_SIZE],
    expected[STATE_SIZE];
static unsigned char own_hash[32], own_code[32], fund_script[85];

static u128 read128(const unsigned char *p) {
  u128 n;
  memcpy(&n, p, 16);
  return n;
}
static uint64_t read64(const unsigned char *p) {
  uint64_t n;
  memcpy(&n, p, 8);
  return n;
}
static void write128(unsigned char *p, u128 n) { memcpy(p, &n, 16); }
static int add128(u128 a, u128 b, u128 *r) {
  *r = a + b;
  return *r < a ? E_OVERFLOW : 0;
}
static int add64(uint64_t a, uint64_t b, uint64_t *r) {
  *r = a + b;
  return *r < a ? E_OVERFLOW : 0;
}
static void hash_bytes(const unsigned char *p, size_t n,
                       unsigned char out[32]) {
  blake2b_state b;
  ckb_blake2b_init(&b, 32);
  blake2b_update(&b, p, n);
  blake2b_final(&b, out, 32);
}
static void key_script(const unsigned char *pk, unsigned char out[73]) {
  unsigned char h[32];
  hash_bytes(pk, 33, h);
  memcpy(out, K_TEMPLATE, 73);
  memcpy(out + 53, h, 20);
}
static int field(unsigned char *b, uint64_t n, size_t i, size_t src, size_t f) {
  uint64_t len = n;
  int r = ckb_load_cell_by_field(b, &len, 0, i, src, f);
  return r == CKB_SUCCESS && len == n;
}
static int script_is(size_t i, size_t src, size_t f, const unsigned char *s,
                     size_t n) {
  unsigned char b[128];
  return n <= sizeof(b) && field(b, n, i, src, f) && !memcmp(b, s, n);
}
static int data_is(size_t i, size_t src, const unsigned char *d, size_t n) {
  unsigned char b[STATE_SIZE];
  uint64_t len = sizeof(b);
  int r = ckb_load_cell_data(b, &len, 0, i, src);
  return r == CKB_SUCCESS && len == n && (!n || !memcmp(b, d, n));
}
static int no_type(size_t i, size_t src) {
  unsigned char b[32];
  uint64_t len = 32;
  return ckb_load_cell_by_field(b, &len, 0, i, src, CKB_CELL_FIELD_TYPE_HASH) ==
         CKB_ITEM_MISSING;
}
static int count_cells(size_t src, size_t max, size_t *n) {
  for (size_t i = 0; i <= max; i++) {
    uint64_t len = 0;
    int r = ckb_load_cell(NULL, &len, 0, i, src);
    if (r == CKB_INDEX_OUT_OF_BOUND) {
      *n = i;
      return 0;
    }
    REQUIRE(r == CKB_SUCCESS && i < max, E_SHAPE);
  }
  return E_SHAPE;
}
static int capacity(size_t i, size_t src, uint64_t *n) {
  return field((unsigned char *)n, 8, i, src, CKB_CELL_FIELD_CAPACITY)
             ? 0
             : E_CAPACITY;
}
static int own_type(size_t i, size_t src) {
  unsigned char h[32];
  return field(h, 32, i, src, CKB_CELL_FIELD_TYPE_HASH) &&
         !memcmp(h, own_hash, 32);
}
static int token_amount(size_t i, size_t src, u128 *n) {
  unsigned char b[16];
  uint64_t len = 16;
  REQUIRE(script_is(i, src, CKB_CELL_FIELD_TYPE, TOKEN_SCRIPT, 85), E_TOKEN);
  REQUIRE(ckb_load_cell_data(b, &len, 0, i, src) == CKB_SUCCESS && len == 16,
          E_TOKEN);
  *n = read128(b);
  return 0;
}
static int state_valid(const unsigned char *s) {
  REQUIRE(!memcmp(s, "QCP1\x01\x00", 6) && s[6] <= 1 && !(s[7] & ~3), E_STATE);
  REQUIRE(!s[6] || !s[7], E_STATE);
  REQUIRE(!memcmp(s + 40, TOKEN_SCRIPT, 85), E_TOKEN);
  u128 total;
  TRY(add128(read128(s + 280), read128(s + 434), &total));
  REQUIRE(total == read128(s + 24) && total <= read128(s + 8), E_STATE);
  unsigned char auth[3][73];
  size_t keys[3] = {125, 158, 312};
  for (size_t d = 0; d < 3; d++) {
    REQUIRE(s[keys[d]] == 2 || s[keys[d]] == 3, E_STATE);
    key_script(s + keys[d], auth[d]);
    unsigned char h[32];
    hash_bytes(auth[d], 73, h);
    REQUIRE(memcmp(h, TOKEN_SCRIPT + 53, 32), E_TOKEN);
    for (size_t j = 0; j < d; j++)
      REQUIRE(memcmp(auth[d], auth[j], 73), E_STATE);
  }
  unsigned char a_hash[32], f_hash[32];
  hash_bytes(A_SCRIPT, 53, a_hash);
  hash_bytes(fund_script, 85, f_hash);
  REQUIRE(memcmp(a_hash, TOKEN_SCRIPT + 53, 32) &&
              memcmp(f_hash, TOKEN_SCRIPT + 53, 32),
          E_TOKEN);
  for (size_t d = 0; d < 2; d++) {
    size_t o = 158 + 154 * d;
    u128 l = read128(s + o + 106), u = read128(s + o + 122),
         p = read128(s + o + 138);
    REQUIRE(u <= l && l <= read128(s + 8) && p > 0 && p <= l, E_STATE);
    /* Exact canonical K template fixes code/hash type/length; args are
     * recipient identity. */
    REQUIRE(!memcmp(s + o + 33, K_TEMPLATE, 53), E_STATE);
    for (size_t j = 0; j < 3; j++)
      REQUIRE(memcmp(s + o + 33, auth[j], 73), E_STATE);
  }
  REQUIRE(memcmp(s + 191, s + 345, 73), E_STATE);
  return 0;
}
static int dependencies(void) {
  const unsigned char *hs[6] = {A_DATA_HASH,      F_DATA_HASH, T_DATA_HASH,
                                K_CODE_DATA_HASH, K_DATA_HASH, own_code};
  unsigned int seen = 0;
  for (size_t i = 0; i <= 6; i++) {
    unsigned char h[32], th[32];
    uint64_t len = 32;
    int r = ckb_load_cell_by_field(h, &len, 0, i, CKB_SOURCE_CELL_DEP,
                                   CKB_CELL_FIELD_DATA_HASH);
    if (r == CKB_INDEX_OUT_OF_BOUND)
      return seen == 63 ? 0 : E_DEPS;
    REQUIRE(r == CKB_SUCCESS && len == 32 && i < 6, E_DEPS);
    size_t k = 0;
    while (k < 6 && memcmp(h, hs[k], 32))
      k++;
    REQUIRE(k < 6 && !(seen & (1u << k)), E_DEPS);
    seen |= 1u << k;
    if (k == 3)
      REQUIRE(field(th, 32, i, CKB_SOURCE_CELL_DEP, CKB_CELL_FIELD_TYPE_HASH) &&
                  !memcmp(th, K_TYPE_HASH, 32),
              E_DEPS);
  }
  return E_DEPS;
}
static int action(size_t actor_index, size_t nin, unsigned char out[57],
                  size_t *action_len) {
  unsigned char buf[192];
  for (size_t i = 0; i < nin; i++) {
    uint64_t len = sizeof(buf);
    int r = ckb_load_witness(buf, &len, 0, i, CKB_SOURCE_INPUT);
    REQUIRE(r == CKB_SUCCESS && len <= sizeof(buf), E_WITNESS);
    if (i != actor_index) {
      REQUIRE(len == 0, E_WITNESS);
      continue;
    }
    mol_seg_t w = {buf, (mol_num_t)len};
    REQUIRE(MolReader_WitnessArgs_verify(&w, false) == MOL_OK, E_WITNESS);
    mol_seg_t l = MolReader_WitnessArgs_get_lock(&w),
              a = MolReader_WitnessArgs_get_input_type(&w),
              o = MolReader_WitnessArgs_get_output_type(&w);
    REQUIRE(l.size == 69 && a.size >= 12 && o.size == 0, E_WITNESS);
    a = MolReader_Bytes_raw_bytes(&a);
    REQUIRE(a.size <= 57, E_WITNESS);
    memcpy(out, a.ptr, a.size);
    *action_len = a.size;
  }
  uint64_t len = 0;
  REQUIRE(ckb_load_witness(NULL, &len, 0, nin, CKB_SOURCE_INPUT) ==
              CKB_INDEX_OUT_OF_BOUND,
          E_WITNESS);
  REQUIRE(*action_len >= 8 && !memcmp(out, "QCA1", 4) && !out[6] && !out[7] &&
              out[4] <= 5,
          E_WITNESS);
  size_t expected_len = out[4] == 2 ? 57 : (out[4] == 3 ? 9 : 8);
  REQUIRE(*action_len == expected_len, E_WITNESS);
  return 0;
}
static int actor_input(size_t i, const unsigned char *pk) {
  unsigned char k[73];
  key_script(pk, k);
  REQUIRE(script_is(i, CKB_SOURCE_INPUT, CKB_CELL_FIELD_LOCK, k, 73) &&
              no_type(i, CKB_SOURCE_INPUT) &&
              data_is(i, CKB_SOURCE_INPUT, NULL, 0),
          E_AUTH);
  return 0;
}
static int change_output(size_t i, size_t nout, const unsigned char *pk) {
  REQUIRE(nout == i || nout == i + 1, E_SHAPE);
  if (nout == i + 1) {
    unsigned char k[73];
    key_script(pk, k);
    REQUIRE(script_is(i, CKB_SOURCE_OUTPUT, CKB_CELL_FIELD_LOCK, k, 73) &&
                no_type(i, CKB_SOURCE_OUTPUT) &&
                data_is(i, CKB_SOURCE_OUTPUT, NULL, 0),
            E_SHAPE);
  }
  return 0;
}
int main(void) {
  unsigned char current[85];
  uint64_t len = 85;
  REQUIRE(ckb_load_script(current, &len, 0) == CKB_SUCCESS && len == 85,
          E_LINEAGE);
  mol_seg_t sc = {current, 85};
  REQUIRE(MolReader_Script_verify(&sc, false) == MOL_OK, E_LINEAGE);
  mol_seg_t args = MolReader_Script_get_args(&sc);
  args = MolReader_Bytes_raw_bytes(&args);
  REQUIRE(args.size == 32 && current[48] == 4, E_LINEAGE);
  memcpy(own_code, current + 16, 32);
  len = 32;
  REQUIRE(ckb_load_script_hash(own_hash, &len, 0) == CKB_SUCCESS && len == 32,
          E_LINEAGE);
  memcpy(fund_script, F_TEMPLATE, 85);
  memcpy(fund_script + 53, own_hash, 32);
  size_t gin, gout, nin, nout;
  TRY(count_cells(CKB_SOURCE_GROUP_INPUT, 1, &gin));
  TRY(count_cells(CKB_SOURCE_GROUP_OUTPUT, 1, &gout));
  REQUIRE(gout == 1, E_LINEAGE); /* Includes owner paths; no state deletion. */
  TRY(count_cells(CKB_SOURCE_INPUT, MAX_INPUTS, &nin));
  TRY(count_cells(CKB_SOURCE_OUTPUT, 4, &nout));
  REQUIRE(nin > 0 && nout > 0 && own_type(0, CKB_SOURCE_OUTPUT), E_LINEAGE);
  REQUIRE(script_is(0, CKB_SOURCE_OUTPUT, CKB_CELL_FIELD_LOCK, A_SCRIPT, 53),
          E_LINEAGE);
  REQUIRE(ckb_validate_type_id(args.ptr) == CKB_SUCCESS, E_LINEAGE);
  TRY(dependencies());
  len = STATE_SIZE;
  REQUIRE(ckb_load_cell_data(new_state, &len, 0, 0, CKB_SOURCE_OUTPUT) ==
                  CKB_SUCCESS &&
              len == STATE_SIZE,
          E_STATE);
  TRY(state_valid(new_state));
  unsigned char act[57] = {0};
  size_t alen = 0, ai = gin ? 1 : 0;
  REQUIRE(nin > ai, E_SHAPE);
  TRY(action(ai, nin, act, &alen));
  for (size_t i = 0; i < nin; i++) {
    unsigned char b[8];
    len = 8;
    REQUIRE(ckb_load_input_by_field(b, &len, 0, i, CKB_SOURCE_INPUT,
                                    CKB_INPUT_FIELD_SINCE) == CKB_SUCCESS &&
                len == 8 && !read64(b),
            E_SHAPE);
  }
  len = 0;
  REQUIRE(ckb_load_header(NULL, &len, 0, 0, CKB_SOURCE_HEADER_DEP) ==
              CKB_INDEX_OUT_OF_BOUND,
          E_SHAPE);
  uint64_t cin = 0, cout = 0, c;
  for (size_t i = 0; i < nin; i++) {
    TRY(capacity(i, CKB_SOURCE_INPUT, &c));
    TRY(add64(cin, c, &cin));
  }
  for (size_t i = 0; i < nout; i++) {
    TRY(capacity(i, CKB_SOURCE_OUTPUT, &c));
    TRY(add64(cout, c, &cout));
  }
  REQUIRE(cout <= cin && cin - cout <= MAX_FEE, E_CAPACITY);
  if (!gin) {
    REQUIRE(act[4] == 0 && act[5] == 255 && nin == 1, E_GENESIS);
    REQUIRE(new_state[6] == 0 && new_state[7] == 3 &&
                !read128(new_state + 24) && !read128(new_state + 280) &&
                !read128(new_state + 434),
            E_GENESIS);
    TRY(actor_input(0, new_state + 125));
    TRY(change_output(1, nout, new_state + 125));
    return 0;
  }
  REQUIRE(own_type(0, CKB_SOURCE_INPUT) &&
              script_is(0, CKB_SOURCE_INPUT, CKB_CELL_FIELD_LOCK, A_SCRIPT, 53),
          E_LINEAGE);
  len = STATE_SIZE;
  REQUIRE(ckb_load_cell_data(old_state, &len, 0, 0, CKB_SOURCE_INPUT) ==
                  CKB_SUCCESS &&
              len == STATE_SIZE,
          E_STATE);
  TRY(state_valid(old_state));
  uint64_t pcin, pcout;
  TRY(capacity(0, CKB_SOURCE_INPUT, &pcin));
  TRY(capacity(0, CKB_SOURCE_OUTPUT, &pcout));
  REQUIRE(pcin == pcout, E_CAPACITY);
  unsigned int op = act[4], d = act[5];
  const unsigned char *pk;
  if (op == 1) {
    REQUIRE(d < 2, E_AUTH);
    pk = old_state + 158 + 154 * d;
  } else {
    REQUIRE(op >= 2 && op <= 5 && d == 255, E_AUTH);
    pk = old_state + 125;
  }
  TRY(actor_input(1, pk));
  u128 tokens = 0, a;
  uint64_t protected_capacity = 0;
  for (size_t i = 2; i < nin; i++) {
    REQUIRE(
        script_is(i, CKB_SOURCE_INPUT, CKB_CELL_FIELD_LOCK, fund_script, 85),
        E_SHAPE);
    TRY(token_amount(i, CKB_SOURCE_INPUT, &a));
    TRY(add128(tokens, a, &tokens));
    TRY(capacity(i, CKB_SOURCE_INPUT, &c));
    TRY(add64(protected_capacity, c, &protected_capacity));
  }
  memcpy(expected, old_state, STATE_SIZE);
  if (op == 1) {
    REQUIRE(!old_state[6], E_CLOSED);
    REQUIRE(old_state[7] & (1u << d), E_DISABLED);
    REQUIRE(nin >= 3 && nout >= 3, E_SHAPE);
    REQUIRE(
        script_is(1, CKB_SOURCE_OUTPUT, CKB_CELL_FIELD_LOCK, fund_script, 85),
        E_SHAPE);
    u128 rest, q;
    TRY(token_amount(1, CKB_SOURCE_OUTPUT, &rest));
    TRY(token_amount(2, CKB_SOURCE_OUTPUT, &q));
    REQUIRE(q > 0, E_TOKEN);
    size_t o = 158 + 154 * d;
    REQUIRE(script_is(2, CKB_SOURCE_OUTPUT, CKB_CELL_FIELD_LOCK,
                      old_state + o + 33, 73),
            E_RECIPIENT);
    TRY(add128(rest, q, &a));
    REQUIRE(a == tokens, E_TOKEN);
    TRY(capacity(1, CKB_SOURCE_OUTPUT, &c));
    REQUIRE(c == protected_capacity, E_CAPACITY);
    REQUIRE(q <= read128(old_state + o + 138), E_PER_PAYMENT);
    TRY(add128(read128(old_state + o + 122), q, &a));
    REQUIRE(a <= read128(old_state + o + 106), E_PERSONAL);
    write128(expected + o + 122, a);
    TRY(add128(read128(old_state + 24), q, &a));
    REQUIRE(a <= read128(old_state + 8), E_SHARED);
    write128(expected + 24, a);
    TRY(change_output(3, nout, pk));
  } else if (op == 2 || op == 3) {
    REQUIRE(!old_state[6], E_CLOSED);
    REQUIRE(nin == 2, E_SHAPE);
    TRY(change_output(1, nout, pk));
    if (op == 2) {
      unsigned int mask = act[56];
      REQUIRE(!(mask & ~3) && !(mask & old_state[7]), E_ADMIN);
      u128 dl = read128(act + 8), da = read128(act + 24),
           db = read128(act + 40);
      REQUIRE(dl || da || db || mask, E_ADMIN);
      TRY(add128(read128(old_state + 8), dl, &a));
      write128(expected + 8, a);
      TRY(add128(read128(old_state + 264), da, &a));
      write128(expected + 264, a);
      TRY(add128(read128(old_state + 418), db, &a));
      write128(expected + 418, a);
      expected[7] |= mask;
    } else {
      unsigned int mask = act[8];
      REQUIRE(mask && !(mask & ~old_state[7]), E_ADMIN);
      expected[7] &= ~mask;
    }
  } else {
    if (op == 4) {
      REQUIRE(!old_state[6], E_CLOSED);
      expected[6] = 1;
      expected[7] = 0;
    } else {
      REQUIRE(old_state[6] == 1, E_CLOSED);
      REQUIRE(nin >= 3, E_SHAPE);
    }
    size_t next = 1;
    if (nin > 2) {
      unsigned char k[73];
      key_script(pk, k);
      REQUIRE(nout > 1 &&
                  script_is(1, CKB_SOURCE_OUTPUT, CKB_CELL_FIELD_LOCK, k, 73),
              E_RECIPIENT);
      TRY(token_amount(1, CKB_SOURCE_OUTPUT, &a));
      REQUIRE(a == tokens, E_TOKEN);
      TRY(capacity(1, CKB_SOURCE_OUTPUT, &c));
      REQUIRE(c == protected_capacity, E_CAPACITY);
      next = 2;
    }
    TRY(change_output(next, nout, pk));
  }
  /* Pin all non-admin terms and preserve exactly the calculated counters. */
  REQUIRE(!memcmp(expected, new_state, STATE_SIZE), E_COUNTER);
  return 0;
}
