import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ConversationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findConversationFirst<T extends Prisma.ConversationFindFirstArgs>(
    args: Prisma.SelectSubset<T, Prisma.ConversationFindFirstArgs>,
  ) {
    return this.prisma.conversation.findFirst(args);
  }

  createConversation<T extends Prisma.ConversationCreateArgs>(
    args: Prisma.SelectSubset<T, Prisma.ConversationCreateArgs>,
  ) {
    return this.prisma.conversation.create(args);
  }

  updateConversation<T extends Prisma.ConversationUpdateArgs>(
    args: Prisma.SelectSubset<T, Prisma.ConversationUpdateArgs>,
  ) {
    return this.prisma.conversation.update(args);
  }

  findCustomerFirst<T extends Prisma.CustomerFindFirstArgs>(
    args: Prisma.SelectSubset<T, Prisma.CustomerFindFirstArgs>,
  ) {
    return this.prisma.customer.findFirst(args);
  }

  createCustomer<T extends Prisma.CustomerCreateArgs>(
    args: Prisma.SelectSubset<T, Prisma.CustomerCreateArgs>,
  ) {
    return this.prisma.customer.create(args);
  }

  updateCustomer<T extends Prisma.CustomerUpdateArgs>(
    args: Prisma.SelectSubset<T, Prisma.CustomerUpdateArgs>,
  ) {
    return this.prisma.customer.update(args);
  }

  createConversationJobLink<T extends Prisma.ConversationJobLinkCreateArgs>(
    args: Prisma.SelectSubset<T, Prisma.ConversationJobLinkCreateArgs>,
  ) {
    return this.prisma.conversationJobLink.create(args);
  }

  async createConversationJobLinkOrNullOnConflict<
    T extends Prisma.ConversationJobLinkCreateArgs,
  >(args: Prisma.SelectSubset<T, Prisma.ConversationJobLinkCreateArgs>) {
    try {
      return await this.prisma.conversationJobLink.create(args);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return null;
      }
      throw error;
    }
  }
}
