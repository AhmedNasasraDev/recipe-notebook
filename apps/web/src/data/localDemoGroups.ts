// §10 for a checkout with no Supabase project — which is to say: no.
//
// A GROUP IS OTHER PEOPLE. There is no honest local version of it: a course,
// an invitation, a member list and a chat all mean somebody else, and this mode
// has no account, no server and no second person. The prototype shipped a demo
// group with eighteen fictional students and a chat that went nowhere, and §17
// is explicit that that is the one thing this app may not do.
//
// So every read here is empty and every write is refused in words. The groups
// screen reads `capabilities().source` and explains it once, at the top, rather
// than letting each button fail on its own.
//
// The refusal is not a stub waiting to be implemented. It is the answer.

import {
  WriteNotAllowedError,
  type ChatEvents,
  type ChatSubscription,
  type GroupRepository,
  type IdentityRepository,
} from './repository.js';
import type { ChatPage } from '../features/groups/types.js';

const NO_GROUPS =
  'קבוצות וקורסים עובדים מול חשבון ושרת. בהתקנה הזאת אין חיבור לשרת, ולכן אין ' +
  'קבוצות, אין חברים ואין צ׳אט — ולא נציג רשימה מומצאת במקום.';

const NO_IDENTITY =
  'שם ותמונת פרופיל נשמרים לחשבון ומוצגים לחברי הקבוצה. בהתקנה הזאת אין חשבון.';

function refuse(): never {
  throw new WriteNotAllowedError(NO_GROUPS);
}

export function createLocalDemoGroups(): GroupRepository & IdentityRepository {
  return {
    async listGroups() {
      return [];
    },
    async createGroup() {
      return refuse();
    },
    async getGroup() {
      return null;
    },
    async updateGroup() {
      return refuse();
    },
    async deleteGroup() {
      return refuse();
    },
    async leaveGroup() {
      return refuse();
    },

    async roster() {
      return [];
    },
    async avatarUrls() {
      return {};
    },
    async setMemberRole() {
      return refuse();
    },
    async removeMember() {
      return refuse();
    },

    async listInvites() {
      return [];
    },
    async createInvite() {
      return refuse();
    },
    async sendInviteEmail() {
      return { sent: false, reason: NO_GROUPS };
    },
    async revokeInvite() {
      return refuse();
    },
    async resendInvite() {
      return refuse();
    },
    async redeemInvite() {
      // The one that hurts: somebody arrives holding a real invitation link
      // and this build cannot honour it. Saying so is the only option that
      // does not waste the token — a redemption is single use.
      throw new WriteNotAllowedError(
        'ההזמנה תקפה, אבל בהתקנה הזאת אין חיבור לשרת ולכן אי אפשר להצטרף כאן. ' +
          'הקישור נשאר תקף — אפשר לפתוח אותו מהאפליקציה המחוברת לחשבון.',
      );
    },
    async rejectInvite() {
      return refuse();
    },

    async listJoinRequests() {
      return [];
    },
    async myJoinRequests() {
      return [];
    },
    async requestJoin() {
      return refuse();
    },
    async approveJoin() {
      return refuse();
    },
    async rejectJoin() {
      return refuse();
    },
    async withdrawJoin() {
      return refuse();
    },

    async addCourse() {
      return refuse();
    },
    async renameCourse() {
      return refuse();
    },
    async removeCourse() {
      return refuse();
    },
    async addLesson() {
      return refuse();
    },
    async updateLesson() {
      return refuse();
    },
    async removeLesson() {
      return refuse();
    },
    async publishRecipe() {
      return refuse();
    },
    async unpublishItem() {
      return refuse();
    },
    async setItemPerms() {
      return refuse();
    },
    async saveGroupCopy() {
      return refuse();
    },

    async getItemNote() {
      return null;
    },
    async saveItemNote() {
      return refuse();
    },

    async chatPage(): Promise<ChatPage> {
      return { messages: [], hasMore: false };
    },
    async sendMessage() {
      return refuse();
    },
    async editMessage() {
      return refuse();
    },
    async deleteMessage() {
      return refuse();
    },
    async markGroupRead() {
      // Nothing to mark, and nowhere to mark it. Not an error: the caller does
      // this on every render of an open conversation, and there is none.
    },
    async lastReadSeq() {
      return 0;
    },
    subscribeGroupChat(_groupId: string, events: ChatEvents): ChatSubscription {
      /*
        Reports `error` rather than `connecting` forever. A spinner that never
        resolves is the shape of dishonesty this file exists to avoid — the
        screen shows "no connection" instead.
      */
      events.onStatus?.('error');
      return { unsubscribe() {} };
    },

    async getIdentity() {
      return { displayName: '', avatarPath: null, firstName: null, lastName: null };
    },
    async saveDisplayName() {
      throw new WriteNotAllowedError(NO_IDENTITY);
    },
    async saveProfileNames() {
      throw new WriteNotAllowedError(NO_IDENTITY);
    },
    async setAvatar() {
      throw new WriteNotAllowedError(NO_IDENTITY);
    },
    async removeAvatar() {
      throw new WriteNotAllowedError(NO_IDENTITY);
    },
    async avatarUrl() {
      return null;
    },
  };
}
