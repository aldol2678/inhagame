// Synthetic in-memory boundary only. Never connects to a real account, service, or database.
export const COOKING_FIXTURE_IDS = Object.freeze({
  accountA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  accountB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  roomA: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  roomB: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  mutation: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
});

export function createSyntheticCookingBackend() {
  const ids = COOKING_FIXTURE_IDS;
  let actor = ids.accountA;
  const makeRoom = (accountId, roomId) => ({ accountId, ownerUserId: accountId, roomId,
    role: 'owner', space: 'ROOM_PERSONAL_BASIC', ready: true, editing: false, busy: false,
    objects: [{ id: ids.mutation, itemId: 'furniture.cooking_station', surface: 'floor', x: -6, z: 0, yaw: 0 }] });
  let room = makeRoom(actor, ids.roomA);
  const ledger = new Map(), receipts = new Map(), calls = [], reads = [];
  const cookQueue = [], readQueue = [], heldCooks = [], heldReads = [];
  let commits = 0, completedCooks = 0, completedReads = 0;
  const quantities = accountId => {
    if (!ledger.has(accountId)) ledger.set(accountId, { carp: 2, grilled: 0 });
    return ledger.get(accountId);
  };
  const inventory = { accountId: actor, state: 'READY', quantities: { ...quantities(actor) },
    async refresh(reason) {
      if (reason !== 'cooking') throw Error('Unexpected synthetic Inventory read reason');
      const accountId = inventory.accountId;
      reads.push({ reason, accountId });
      const complete = kind => {
        completedReads++;
        if (accountId !== actor || inventory.accountId !== accountId) return false;
        if (kind === 'failure') { inventory.state = 'UNAVAILABLE'; return false; }
        if (kind !== 'success') throw Error(`Unknown synthetic Inventory outcome: ${kind}`);
        inventory.state = 'READY'; inventory.quantities = { ...quantities(accountId) }; return true;
      };
      const kind = readQueue.shift() ?? 'success';
      if (kind === 'hold') return new Promise(resolve => heldReads.push(outcome => resolve(complete(outcome))));
      return complete(kind);
    }
  };
  const rpc = async (name, args) => {
    if (name !== 'cook_my_world_recipe_v1' || args.p_recipe_id !== 'recipe.carp_grill' ||
        Object.keys(args).sort().join(',') !== 'p_recipe_id,p_request_id') throw Error('Unexpected synthetic RPC');
    const accountId = actor, roomId = room.roomId;
    calls.push({ name, args: { ...args }, accountId, roomId });
    const complete = kind => {
      completedCooks++;
      if (!['success', 'ambiguous'].includes(kind)) throw Error(`Unknown synthetic recipe outcome: ${kind}`);
      const key = `${accountId}:${args.p_request_id}`;
      if (!receipts.has(key)) {
        const q = quantities(accountId);
        if (q.carp < 1) return { data: null, error: { message: 'INSUFFICIENT_QUANTITY' } };
        const before = { ...q }; q.carp--; q.grilled++; commits++;
        receipts.set(key, { status: 'SUCCESS', userId: accountId, roomId, requestId: args.p_request_id,
          recipeId: args.p_recipe_id, definitionVersion: 1, layoutRevision: 1,
          inventory: { status: 'SUCCESS', userId: accountId, mutationId: ids.mutation,
            mutationType: 'COOK', sourceType: 'CRAFTING', sourceRef: args.p_recipe_id,
            idempotencyKey: `recipe:${accountId}:${args.p_request_id}`,
            entries: [
              { direction: 'CONSUME', itemId: 'material.fish_carp', quantity: 1, quantityBefore: before.carp, quantityAfter: q.carp },
              { direction: 'GRANT', itemId: 'consumable.grilled_carp', quantity: 1, quantityBefore: before.grilled, quantityAfter: q.grilled }
            ] } });
      }
      // Simulate a committed transaction whose reply was lost, then immutable receipt replay.
      if (kind === 'ambiguous') return { data: null, error: { message: 'Synthetic lost reply after commit' } };
      return { data: structuredClone(receipts.get(key)), error: null };
    };
    const kind = cookQueue.shift() ?? 'success';
    if (kind === 'hold') return new Promise(resolve => heldCooks.push(outcome => resolve(complete(outcome))));
    return complete(kind);
  };
  const release = (queue, kind) => {
    const next = queue.shift();
    if (!next) throw Error('No held synthetic operation');
    next(kind);
  };
  return {
    getClient: () => ({ rpc }), getUserId: () => actor, getRoomState: () => room, inventory,
    queueCook: kind => cookQueue.push(kind), queueRead: kind => readQueue.push(kind),
    releaseCook: kind => release(heldCooks, kind), releaseRead: kind => release(heldReads, kind),
    patchRoom: patch => { Object.assign(room, patch); },
    changeScope(kind) {
      if (kind === 'account') {
        actor = ids.accountB; room = makeRoom(actor, ids.roomB);
        inventory.accountId = actor; inventory.state = 'READY'; inventory.quantities = { ...quantities(actor) };
      } else if (kind === 'room') room = makeRoom(actor, ids.roomB);
      else throw Error(`Unknown synthetic scope: ${kind}`);
    },
    snapshot: () => structuredClone({ actor, room, inventory: { accountId: inventory.accountId,
      state: inventory.state, quantities: inventory.quantities }, serverQuantities: quantities(actor), calls, reads,
      commits, committedReceipts: [...receipts.values()], completedCooks, completedReads,
      heldCooks: heldCooks.length, heldReads: heldReads.length })
  };
}
