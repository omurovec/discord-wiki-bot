/**
 * The core server that runs on a Cloudflare worker.
 */

import { AutoRouter } from 'itty-router';
import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from 'discord-interactions';
import { PULL_COMMAND } from './commands.js';

class JsonResponse extends Response {
  constructor(body, init) {
    const jsonBody = JSON.stringify(body);
    init = init || {
      headers: {
        'content-type': 'application/json;charset=UTF-8',
      },
    };
    super(jsonBody, init);
  }
}

const router = AutoRouter();

const url = 'https://en.wikipedia.org/wiki/Special:Random';

// Map to store last pull timestamp for each server
const lastPullTimestamps = new Map();

function updateLastPullTimestamp(guildId, userId) {
  let guildMap = lastPullTimestamps.get(guildId);
  if (!guildMap) {
    guildMap = new Map();
    lastPullTimestamps.set(guildId, guildMap);
  }
  guildMap.set(userId, Date.now());
}

function hasReachedDailyLimit(guildId, userId) {
  const guildMap = lastPullTimestamps.get(guildId);
  if (!guildMap) {
    return false;
  }
  const lastPullTimestamp = guildMap.get(userId);
  if (!lastPullTimestamp) {
    return false;
  }

  const now = new Date();
  const lastPullDate = new Date(lastPullTimestamp);
  return now.toDateString() === lastPullDate.toDateString();
}

/**
 * A simple :wave: hello page to verify the worker is working.
 */
router.get('/', (request, env) => {
  return new Response(`👋 ${env.DISCORD_APPLICATION_ID}`);
});

/**
 * Main route for all requests sent from Discord.  All incoming messages will
 * include a JSON payload described here:
 * https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-object
 */
router.post('/', async (request, env) => {
  const { isValid, interaction } = await server.verifyDiscordRequest(
    request,
    env,
  );
  if (!isValid || !interaction) {
    return new Response('Bad request signature.', { status: 401 });
  }

  if (interaction.type === InteractionType.PING) {
    // The `PING` message is used during the initial webhook handshake, and is
    // required to configure the webhook in the developer portal.
    return new JsonResponse({
      type: InteractionResponseType.PONG,
    });
  }

  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    // Most user commands will come as `APPLICATION_COMMAND`.
    switch (interaction.data.name.toLowerCase()) {
      case PULL_COMMAND.name.toLowerCase(): {
        const { guild_id, member } = interaction;
        // return warning if already pulled
        if (hasReachedDailyLimit(guild_id, member.user.id)) {
          return new JsonResponse({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: `You have already pulled a Wikipedia page today, <@${member.user.id}>. Try again tomorrow!`,
            },
          });
        }

        const response = await fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
        });

        updateLastPullTimestamp(guild_id, member.user.id);

        return new JsonResponse({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: `<@${member.user.id}> pulled\n${response.url}`,
          },
        });
      }
      default:
        return new JsonResponse({ error: 'Unknown Type' }, { status: 400 });
    }
  }

  console.error('Unknown Type');
  return new JsonResponse({ error: 'Unknown Type' }, { status: 400 });
});
router.all('*', () => new Response('Not Found.', { status: 404 }));

async function verifyDiscordRequest(request, env) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const body = await request.text();
  const isValidRequest =
    signature &&
    timestamp &&
    (await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY));
  if (!isValidRequest) {
    return { isValid: false };
  }

  return { interaction: JSON.parse(body), isValid: true };
}

const server = {
  verifyDiscordRequest,
  fetch: router.fetch,
};

export default server;
