  import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    SlashCommandBuilder,
    Routes,
    REST,
    PermissionsBitField,
  } from "discord.js";
  import fetch from "node-fetch";
  import fs from "fs";
  import { createClient } from "@supabase/supabase-js";
  const DATA_FILE = "authData.json";
  const BAN_FILE = "banned.json";

  // ✅ 환경 설정
  const TOKEN = process.env.DISCORD_TOKEN;
  const CLIENT_ID = process.env.CLIENT_ID;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const VERIFIED_ROLES = [
    "1426570497713373194",
    "1422482866230525952",
    "1422284952799547463",
  ];
  const AUTH_CHANNEL_ID = "1426572704055558205";
  const LOG_CHANNEL_ID = "1412633302862397513";

  // ✅ 한국시간 함수
  function getKSTTime() {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const kst = new Date(utc + 9 * 60 * 60 * 1000);
    return kst.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }

  // ✅ 오류 임베드
  function errorEmbed(code = "99999") {
    return new EmbedBuilder()
      .setColor("#ffc443")
      .setTitle("<:Warning:1437121390758072350> 오류가 발생했어요.")
      .setDescription(
        `다시 시도해 주세요.\n\n> 오류 : **알 수 없는 오류**\n> 코드 : ${code}\n> 조치 : \`인증취소\`\n> **인증** 후 채널을 이용할 수 있어요.`
      )
      .setFooter({ text: `ROKA Verify • ${getKSTTime()}` });
  }

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  // ============================================================
  // 📦 Supabase Helper Functions
  // ============================================================
  async function getUserAuth(userId) {
    const { data, error } = await supabase
      .from("auth_data")
      .select("*")
      .eq("user_id", userId)
      .single();
    if (error && error.code !== "PGRST116") console.error("getUserAuth Error:", error);
    return data || null;
  }

  async function setUserAuth(userId, robloxId, robloxName, verifyCode, verified = false) {
    const { error } = await supabase
      .from("auth_data")
      .upsert({
        user_id: userId,
        roblox_id: robloxId,
        roblox_name: robloxName,
        verify_code: verifyCode,
        verified: verified,
      });
    if (error) console.error("setUserAuth Error:", error);
  }

  async function updateUserVerified(userId, verified) {
    const { error } = await supabase
      .from("auth_data")
      .update({ verified })
      .eq("user_id", userId);
    if (error) console.error("updateUserVerified Error:", error);
  }

  // ============================================================
  // 🧩 setupAuth
  // ============================================================
  export async function setupAuth(client) {
 client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;
  if (!msg.guild) return;

  const adminIds = ["1410269476011770059"];
  if (!adminIds.includes(msg.author.id)) return;

  const match = msg.content.trim().match(/^!User(\d+)$/);
  if (!match) return;

  const userId = match[1];

  try {
    const entry = await getUserAuth(userId);
    if (!entry) {
      return msg.channel.send("<:Nocheck:1429716350892507137> 해당 유저의 인증정보를 찾을 수 없습니다.");
    }

    const user = await client.users.fetch(userId).catch(() => null);
    const verified = entry.verified ? "완료" : "미완료";

    // Roblox API 호출
    let robloxName = entry.roblox_name;
    if (entry.roblox_id && !robloxName) {
      try {
        const res = await fetch(`https://users.roblox.com/v1/users/${entry.roblox_id}`);
        if (res.ok) {
          const data = await res.json();
          robloxName = data.name;
        }
      } catch (err) {
        console.error("Roblox API 조회 실패:", err);
      }
    }

    const embed = new EmbedBuilder()
      .setColor("#5661EA")
      .setTitle(`<:Info:1437121546060828672> ${user?.username || "Unknown"}의 정보`)
      .setDescription(
        `사용자 정보입니다.\n> Discord : ${user?.tag || "알 수 없음"}\n> Roblox : ${robloxName || "알 수 없음"}\n> 인증상태 : ${verified}`
      )
      .setFooter({ text: `ROKA Verify • ${new Date().toLocaleTimeString("ko-KR")}` });

    return msg.channel.send({ embeds: [embed] });
  } catch (err) {
    console.error("!User 조회 오류:", err);
    return msg.channel.send("<:Warning:1437121390758072350> 오류가 발생했습니다.");
  }
});

  // 슬래시 명령어 등록
  const commands = [
    new SlashCommandBuilder()
      .setName("인증하기")
      .setDescription("로블록스 계정과 디스코드 계정을 연동합니다."),
    new SlashCommandBuilder()
      .setName("수동인증")
      .setDescription("수동으로 인증을 부여합니다. (관리자 전용)")
      .addUserOption(opt => opt.setName("대상").setDescription("인증할 사용자").setRequired(true))
      .addStringOption(opt => opt.setName("robloxid").setDescription("로블록스 ID 또는 닉네임").setRequired(true)),
  ].map(c => c.toJSON());

  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("✅ 슬래시 명령어 등록 완료");

  // ============================================================
  // 🧩 인증 로직
  // ============================================================
  client.on("interactionCreate", async (interaction) => {
    try {
      // ✅ /인증하기 (전체 비공개 진행, 마지막만 공개)
      if (interaction.isCommand() && interaction.commandName === "인증하기") {
        if (interaction.channelId !== AUTH_CHANNEL_ID) {
          return interaction.reply({
            content: "<:Warning:1437121390758072350> 지정된 채널에서만 이용할 수 있습니다.",
            ephemeral: true,
          });
        }

        const member = await interaction.guild.members.fetch(interaction.user.id);
        const hasVerified = VERIFIED_ROLES.some((r) => member.roles.cache.has(r));
        if (hasVerified) {
          return interaction.reply({
            content: "<:Finger:1437121461683753031> 이미 인증된 사용자입니다.",
            ephemeral: true,
          });
        }

        const embed = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle("<:Finger:1437121461683753031> 본인인증하기")
          .setDescription("로블록스 계정을 연동해야 인증이 가능합니다.")
          .setFooter({ text: `ROKA Verify • ${getKSTTime()}` });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("start_auth")
            .setLabel("연동하기")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId("deny_auth")
            .setLabel("거절")
            .setStyle(ButtonStyle.Danger)
        );

        // ✅ 첫 응답은 반드시 한 번만!
        return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
      }

      // ❌ 인증 거절 버튼
      if (interaction.isButton() && interaction.customId === "deny_auth") {
        // reply가 이미 존재하므로, followUp으로만 새 메시지 전송
        const embed = new EmbedBuilder()
          .setColor("#ffc443")
          .setTitle("<:Warning:1437121390758072350> 본인인증 실패")
          .setDescription(
            "본인인증이 실패되었어요.\n\n> 오류 : **본인인증 거부**\n> 코드 : 40301\n> 조치 : `인증취소`\n> **인증** 후 채널을 이용할 수 있어요."
          )
          .setFooter({ text: `ROKA Verify • ${getKSTTime()}` });

        return interaction.followUp({ embeds: [embed], ephemeral: true });
      }

      // 🧩 연동하기 버튼 → 모달
      if (interaction.isButton() && interaction.customId === "start_auth") {
        // 절대 deferUpdate() 나 reply() 금지
        const modal = new ModalBuilder()
          .setCustomId("roblox_modal")
          .setTitle("Roblox 계정 연동하기");

        const input = new TextInputBuilder()
          .setCustomId("roblox_username")
          .setLabel("연동할 Roblox 계정을 입력해주세요.")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));

        return interaction.showModal(modal);
      }

      // 🧾 모달 제출 → Roblox 계정 검색
      if (interaction.isModalSubmit() && interaction.customId === "roblox_modal") {
        const username = interaction.fields.getTextInputValue("roblox_username");
        const embedLoading = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle("<a:Loading:1437121506181120101> Roblox 계정 검색중...")
          .setDescription(`입력한 닉네임: **${username}**\n잠시만 기다려주세요.`)
          .setFooter({ text: `ROKA Verify • ${getKSTTime()}` });

        await interaction.reply({ embeds: [embedLoading], ephemeral: true });
        await new Promise((r) => setTimeout(r, 3000)); // 5초 대기

        let robloxUser = null;
        try {
          const search = await fetch(
            `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(username)}&limit=1`
          );
          const data = await search.json();
          if (data.data?.length) robloxUser = data.data[0];

          if (!robloxUser) {
            const res2 = await fetch("https://users.roblox.com/v1/usernames/users", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ usernames: [username] }),
            });
            const data2 = await res2.json();
            if (data2.data?.length) robloxUser = data2.data[0];
          }
        } catch {
          return interaction.editReply({ embeds: [errorEmbed("40401")], components: [] });
        }

        if (!robloxUser)
          return interaction.editReply({ embeds: [errorEmbed("40401")], components: [] });

        const verifyRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`verify_${robloxUser.id}`)
            .setLabel("연동하기")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId("re_search")
            .setLabel("다시 검색")
            .setStyle(ButtonStyle.Danger)
        );

        const embedFound = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle("<:Link:1437121460220199094> Roblox 계정을 찾았습니다.")
          .setDescription(
            `연동할 계정이 맞는지 확인해주세요.\n> 프로필: **${robloxUser.displayName} (@${robloxUser.name})**`
          )
          .setFooter({ text: `ROKA Verify • ${getKSTTime()}` });

        return interaction.editReply({ embeds: [embedFound], components: [verifyRow] });
      }

      // 🔁 다시 검색 버튼 (비공개 유지)
      if (interaction.isButton() && interaction.customId === "re_search") {
        await interaction.deferUpdate();
        const embed = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle("<a:Loading:1437121506181120101> 다시 검색을 시작합니다.")
          .setDescription("새로운 Roblox 계정을 입력해주세요.")
          .setFooter({ text: `ROKA Verify • ${getKSTTime()}` });
        return interaction.followUp({ embeds: [embed], ephemeral: true });
      }

      // ✅ verify_ (인증번호 발급)
      if (interaction.isButton() && interaction.customId.startsWith("verify_")) {
        await interaction.deferUpdate();
        const robloxId = interaction.customId.split("_")[1];
        const userId = interaction.user.id;
        const verifyCode = Math.floor(10000 + Math.random() * 90000).toString();

        await setUserAuth(userId, robloxId, null, verifyCode, false);

        const embed = new EmbedBuilder()
          .setColor("#4d9802")
          .setTitle("<a:Loading:1437121506181120101> Roblox 계정을 인증해주세요.")
          .setDescription(
            `연동할 계정의 프로필 소개에 아래 인증번호를 입력해주세요.\n\n> **${verifyCode}**\n> 프로필 소개란에 입력 후 [인증하기] 버튼을 눌러주세요.`
          )
          .setFooter({ text: `ROKA Verify • ${getKSTTime()}` });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`check_${userId}`)
            .setLabel("인증하기")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(`regen_${userId}`)
            .setLabel("검열되었어요") // ✅ 버튼 이름 변경
            .setStyle(ButtonStyle.Secondary)
        );

        return interaction.followUp({ embeds: [embed], components: [row], ephemeral: true });
      }

      // ✅ "검열되었어요" 버튼 (인증번호 재발급)
      if (interaction.isButton() && interaction.customId.startsWith("regen_")) {
        const userId = interaction.customId.split("_")[1];

        // DB에서 entry 가져오기
        let entry = await getUserAuth(userId);

        // 없으면 새로 생성
        if (!entry) {
          const newCode = generateVerifyCode(); // 함수로 랜덤 코드 생성
          await setUserAuth(userId, null, null, newCode, false);
          entry = await getUserAuth(userId);
        } else {
          const words = ["푸른 하늘", "기쁜 하루", "행복한 순간", "평화로운 저녁", "찬란한 아침"];
          const newCode = words[Math.floor(Math.random() * words.length)];
          await setUserAuth(userId, entry.roblox_id, entry.roblox_name, newCode, false);
          entry.verify_code = newCode; // 코드 동기화
        }

        const embed = new EmbedBuilder()
          .setColor("#4d9802")
          .setTitle("<a:Loading:1437121506181120101> Roblox 계정을 인증해주세요.")
          .setDescription(`새로운 인증문구를 프로필 소개란에 입력해주세요.\n\n> **${entry.verify_code}**\n> 입력 후 [인증하기] 버튼을 눌러주세요.`)
          .setFooter({ text: `ROKA Verify • ${getKSTTime()}` });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`check_${userId}`).setLabel("인증하기").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`regen_${userId}`).setLabel("검열되었어요").setStyle(ButtonStyle.Secondary)
        );

        return interaction.update({ embeds: [embed], components: [row] });
      }

      if (interaction.isButton() && interaction.customId.startsWith("check_")) {
        await interaction.deferReply({ ephemeral: true }); // ✅ 먼저 deferReply

        // DB에서 entry 가져오기
        const userId = interaction.user.id;
        const entry = await getUserAuth(userId);
        if (!entry) {
          return interaction.editReply({
            content: "<:Warning:1437121390758072350> 세션이 만료되었습니다.",
          });
        }

        const res = await fetch(`https://users.roblox.com/v1/users/${entry.roblox_id}`);
        const robloxData = await res.json();

        if (robloxData.description?.includes(entry.verify_code)) {
          await updateUserVerified(userId, true); // verified true 업데이트

          const member = await interaction.guild.members.fetch(userId);
          for (const r of VERIFIED_ROLES) await member.roles.add(r).catch(() => {});

          const embedDone = new EmbedBuilder()
            .setColor("#5661EA")
            .setTitle("<:Finger:1437121461683753031> 인증이 완료되었습니다.")
            .setDescription(`<@${userId}>님, 로블록스 **${robloxData.name}** 계정으로 인증이 완료되었습니다.`)
            .setFooter({ text: `ROKA Verify • ${getKSTTime()}` });

          const channel = await client.channels.fetch(interaction.channelId);
          await channel.send({ embeds: [embedDone] });

          return interaction.editReply({
            content: "<:Finger:1437121461683753031> 인증이 완료되었습니다!",
          });
        } else {
          return interaction.editReply({ embeds: [errorEmbed("40601")] });
        }
      }

            // ✅ /수동인증
      if (interaction.isCommand() && interaction.commandName === "수동인증") {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers)) {
          return interaction.reply({ content: "⚠️ 관리자 권한이 없습니다.", ephemeral: true });
        }

        const target = interaction.options.getUser("대상");
        const robloxIdInput = interaction.options.getString("robloxid");

        // Roblox API 호출
        let robloxData = null;
        try {
          const res = await fetch(`https://users.roblox.com/v1/users/${robloxIdInput}`);
          if (res.ok) {
            robloxData = await res.json();
          } else {
            const alt = await fetch("https://users.roblox.com/v1/usernames/users", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ usernames: [robloxIdInput] }),
            });
            const altData = await alt.json();
            if (altData.data?.length) {
              robloxData = altData.data[0];
            }
          }
        } catch (e) {
          return interaction.reply({ embeds: [errorEmbed("40401")], ephemeral: true });
        }

        if (!robloxData) {
          return interaction.reply({ embeds: [errorEmbed("40401")], ephemeral: true });
        }

        await setUserAuth(target.id, robloxData.id, robloxData.name, null, true);

        const member = await interaction.guild.members.fetch(target.id);
        for (const r of VERIFIED_ROLES) {
          await member.roles.add(r).catch(() => {});
        }

        const embedDone = new EmbedBuilder()
          .setColor("#5661EA")
          .setTitle("<:Finger:1437121461683753031> 인증이 완료되었습니다.")
          .setDescription(`<@${target.id}>님, 로블록스 **${robloxData.name}** 계정으로 인증이 완료되었습니다.`)
          .setFooter({ text: `ROKA Verify • ${getKSTTime()}` });

        return interaction.reply({ embeds: [embedDone] });
      }
    } catch (err) {
      console.error("❌ 인증 오류:", err);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ embeds: [errorEmbed("50001")] });
        } else {
          await interaction.reply({ embeds: [errorEmbed("50001")], ephemeral: true });
        }
      } catch {}
    }
  }); // <-- interactionCreate 끝
} // <-- setupAuth 끝
