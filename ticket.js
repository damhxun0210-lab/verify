import {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
} from "discord.js";
import fs from "fs";
import path from "path";

const TICKET_CATEGORY_ID = "1437143390105112586";
const LOG_CHANNEL_ID = "1411356987953905805";

let ticketCounter = 1;

export async function setupTicket(client) {
  client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;

    if (msg.content === "!티켓") {
      const embed = new EmbedBuilder()
        .setColor("#2a5034")
        .setTitle("<:ROKA:1437150986450899024> 수동인증 요청 티켓")
        .setDescription(
          "본인이 만 8세 미만의 아동이거나, 인증과정 중 문제가 있을 경우 이용해 주시기 바랍니다. " +
          "수동인증은 인증요청시각 기준으로 12시간 내 완료됩니다."
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("open_ticket")
          .setLabel("📩 티켓 열기")
          .setStyle(ButtonStyle.Secondary)
      );

      return msg.channel.send({ embeds: [embed], components: [row] });
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (interaction.isButton() && interaction.customId === "open_ticket") {
      const modal = new ModalBuilder()
        .setCustomId("ticket_modal")
        .setTitle("수동인증 요청하기");

      const discordNameInput = new TextInputBuilder()
        .setCustomId("discord_name")
        .setLabel("본인의 Discord 이름을 알려주세요.")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const robloxNameInput = new TextInputBuilder()
        .setCustomId("roblox_name")
        .setLabel("본인의 Roblox 이름을 알려주세요.")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const confirmationInput = new TextInputBuilder()
        .setCustomId("confirmation")
        .setLabel("장난으로 티켓을 열지 않겠습니다.")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(discordNameInput),
        new ActionRowBuilder().addComponents(robloxNameInput),
        new ActionRowBuilder().addComponents(confirmationInput)
      );

      return interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId === "ticket_modal") {
      await interaction.reply({ content: "*⏳ 티켓생성중...*", ephemeral: true });

      // 3초 대기 후 생성
      setTimeout(async () => {
        const discordName = interaction.fields.getTextInputValue("discord_name");
        const robloxName = interaction.fields.getTextInputValue("roblox_name");
        const prankConfirm = interaction.fields.getTextInputValue("confirmation");

        const ticketName = `수동인증요청-${interaction.user.username}-${ticketCounter++}`;

        const ticketChannel = await interaction.guild.channels.create({
  name: ticketName,
  type: 0,
  parent: TICKET_CATEGORY_ID,
  permissionOverwrites: [
    {
      id: interaction.guild.id, // 전체 일반인 차단
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: interaction.user.id, // 티켓 작성자 허용
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
      ],
    },
    {
      id: "1427689762902511616", // 추가된 역할 권한
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
      ],
    },
  ],
});

        // 티켓 생성 완료 메시지
        await interaction.editReply({
          content: `*${interaction.user}님 ***수동인증요청*** 티켓이 생성되었습니다. <#${ticketChannel.id}> 로 이동하세요.*`,
        });

        // 티켓 채널 임베드
        const ticketEmbed = new EmbedBuilder()
          .setColor("#2a5034")
          .setTitle("수동인증요청")
          .addFields(
            { name: "요청자", value: `${interaction.user.tag}` },
            { name: "디스코드", value: discordName },
            { name: "로블록스", value: robloxName },
            { name: "장난으로 티켓을 열지 않겠습니다.", value: prankConfirm }
          );

        const closeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("close_ticket")
            .setLabel("📩 티켓닫기")
            .setStyle(ButtonStyle.Danger)
        );

        await ticketChannel.send({ embeds: [ticketEmbed], components: [closeRow] });
      }, 2000);
    }

    if (interaction.isButton() && interaction.customId === "close_ticket") {
      const channel = interaction.channel;

      const messages = await channel.messages.fetch({ limit: 100 });
      const lines = messages
  .reverse()
  .map((m) => {
    const timestamp = new Date(m.createdAt.getTime() + 9*60*60*1000) // 한국시간
      .toISOString()
      .replace("T", " ")
      .split(".")[0];

    let content = m.content;

    // Discord 미디어 첨부만 포함
    if (m.attachments.size > 0) {
      const urls = [...m.attachments.values()]
        .map(a => a.url)
        .filter(url => url.startsWith("https://media.discordapp.net")); // Discord 미디어만
      if (urls.length > 0) content += " " + urls.join(" ");
    }

    return `[${timestamp}] ${m.author.tag} : ${content}`;
  })
  .join("\n");

      const filePath = path.join(process.cwd(), `${channel.name}_log.txt`);
      fs.writeFileSync(filePath, lines, "utf-8");

      await channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: false });

      const deleteRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("delete_ticket")
          .setLabel("🗑️ 티켓 삭제하기")
          .setStyle(ButtonStyle.Danger)
      );

      await channel.send({ content: "티켓을 삭제하시겠습니까?", components: [deleteRow] });

      const logChannel = await interaction.guild.channels.fetch(LOG_CHANNEL_ID);
      await logChannel.send({ content: `#${channel.name} 채팅로그`, files: [filePath] });
      fs.unlinkSync(filePath);
    }

    if (interaction.isButton() && interaction.customId === "delete_ticket") {
      const channel = interaction.channel;
      await channel.delete();
    }
  });
}
