import ansiEscapes from "ansi-escapes";
import chalk from "chalk";
import { getGame } from "./game/Game";
import { PacketFactory } from "./packet/PacketFactory";
import { Packet } from "./packet/Packet";
import { PacketType } from "./packet/PacketType";
import {
  boolSelector,
  Command,
  compareAdmin,
  GetCommand,
  playerSelector,
} from "./commandHandler";
import Player from "./sanctuary/Player";
import { setWeaponVariant } from "./functions";
import config from "./config";
import Vec2 from "vec2";
import GameObject from "./gameobjects/GameObject";
import {
  getGameObjDamage,
  getGameObjHealth,
  getScale,
  WeaponModes,
  Weapons,
} from "./items/items";
import { ItemType } from "./items/UpgradeItems";
import { Animals, Broadcast } from "./sanctuary/util";
import { GameModes } from "./game/GameMode";
import db from "enhanced.db";
import * as logger from "./log";
import { Account, getAccount, setAccount } from "./sanctuary/Account";
import { AdminLevel } from "./sanctuary/Admin";
import { WeaponVariant, WeaponVariants } from "./sanctuary/Weapons";
import readline from "readline";
import bcrypt from "bcrypt";
import { PlayerMode } from "./sanctuary/PlayerMode";
import { getGTribe } from "./sanctuary/GTribe";

let command = "";
let lastMessage = "";

// --- Helper Functions to reduce repetition ---
function getSafeGame() {
  return getGame();
}

function resolvePlayerList(selector: any, source: Player | undefined, includeSource: boolean = true): Player[] {
  const result = playerSelector(selector, source, includeSource);
  if (!result) return [];
  if (result instanceof Player) return [result];
  return result; // Is already an array
}

// --- Commands ---

// stop [reason] [seconds]
Command(
  "stop",
  (args: any[], source: Player | undefined) => {
    let timeout = Number(args[args.length - 1]) ? Number(args.pop()) : 10;
    let message = args.slice(1).join(" ");
    getGame()?.close(message, timeout || 0);
  },
  { aliases: ["close", "exit"], level: AdminLevel.Staff }
);

// cancelclose
Command(
  "cancelclose",
  () => {
    getGame()?.cancelClose();
  },
  { aliases: ["stopclose", "cclose"], level: AdminLevel.Admin }
);

// broadcast [message]
Command(
  "broadcast",
  (args: any[]) => {
    let message = args.slice(1).join(" ");
    if (!message) return "No message provided.";
    if (getGame()) {
      Broadcast(message, undefined);
      return false;
    }
  },
  { aliases: ["bc", "send", "echo"], level: AdminLevel.Helper }
);

// kill [playerSelector]
Command(
  "kill",
  (args: any[], source: Player | undefined) => {
    let game = getSafeGame();
    if (!game) return;

    let targets = resolvePlayerList(args[1], source);
    if (targets.length === 0) return "Invalid Player ID";

    targets.forEach((p) => {
      if (compareAdmin(source, p)) game?.killPlayer(p);
    });
  },
  { aliases: ["k"], level: AdminLevel.Moderator }
);

// ip [playerSelector]
Command(
  "ip",
  (args: any[], source: Player | undefined) => {
    let player = playerSelector(args[1], source, false);
    if (!player || !(player instanceof Player)) return "Invalid Player ID";
    return player.client?.ip || "No IP found";
  },
  { aliases: [], level: AdminLevel.Meow }
);

// tp [playerSelector] <playerSelector>
Command(
  "tp",
  (args: any[], source: Player) => {
    let game = getSafeGame();
    if (!game) return;

    let target1 = playerSelector(args[1], source);
    let target2 = playerSelector(args[2], source, false);

    if (!target1) return "Invalid Player ID";

    // Helper to move p1 to p2
    const teleport = (p1: Player, p2: Player) => {
      p1.location = p2.location.add(0, 0, true);
      game?.sendGameObjects(p1);
    };

    if (target1 instanceof Player) {
      // Case: tp <me> <them> OR tp <them>
      if (target2 && target2 instanceof Player) {
        teleport(target1, target2);
      } else {
        if (!source) return "You need to be in-game to teleport to someone.";
        teleport(source, target1);
      }
    } else {
      // Case: tp <all/selector> <dest>
      if (!target2 || !(target2 instanceof Player)) return "You must provide a destination player!";
      target1.forEach((p) => teleport(p, target2 as Player));
    }
    return false;
  },
  { aliases: ["teleport"], level: AdminLevel.Helper }
);

// invisible <playerSelector>
Command(
  "invisible",
  (args: any[], source: Player | undefined) => {
    let game = getSafeGame();
    if (!game) return;

    let targets = resolvePlayerList(args[1], source);
    if (targets.length === 0 && source) targets = [source];
    if (targets.length === 0) return "Player not found.";

    let boolArg = boolSelector(args[2]);
    // If args[1] is a bool (e.g. /invis true), apply to self
    if (targets.length === 1 && targets[0] === source && boolSelector(args[1]) !== null) {
       boolArg = boolSelector(args[1]);
    }

    targets.forEach((p) => {
      if (!compareAdmin(source, p)) return;
      // Toggle if null, otherwise set
      p.invisible = boolArg == null ? !p.invisible : boolArg;
      p.hideLeaderboard = p.invisible;
    });
    
    game.sendLeaderboardUpdates();
  },
  { aliases: ["invis", "vanish", "v"], level: AdminLevel.Moderator }
);

// invincible <playerSelector>
Command(
  "invincible",
  (args: any[], source: Player | undefined) => {
    let game = getSafeGame();
    if (!game) return;

    let targets = resolvePlayerList(args[1], source);
    if (targets.length === 0 && source) targets = [source];
    if (targets.length === 0) return "Player not found.";

    let boolArg = boolSelector(args[2]);
    // If args[1] is a bool, apply to self
    if (targets.length === 1 && targets[0] === source && boolSelector(args[1]) !== null) {
        boolArg = boolSelector(args[1]);
    }

    targets.forEach((p) => {
      p.invincible = boolArg == null ? !p.invincible : boolArg;
    });
  },
  { aliases: ["invinc", "nokill", "iv"], level: AdminLevel.Helper }
);

// spectator <playerSelector>
Command(
  "spectator",
  (args: any[], source: Player | undefined) => {
    let game = getSafeGame();
    if (!game) return;

    let targets = resolvePlayerList(args[1], source);
    if (targets.length === 0 && source) targets = [source];
    if (targets.length === 0) return "Player not found.";

    let boolArg = boolSelector(args[2]);

    const setSpec = (p: Player, enable: boolean) => {
      if (enable) {
        p.spdMult = 8;
        p.buildItem = ItemType.Cookie;
        p.weaponMode = WeaponModes.NoSelect;
        p.mode = PlayerMode.spectator;
        p.invincible = true;
      } else {
        p.spdMult = config.defaultSpeed;
        p.buildItem = -1;
        p.weaponMode = WeaponModes.None;
        p.mode = PlayerMode.normal;
      }
    };

    targets.forEach((p) => {
      let enable = boolArg;
      if (enable === null || enable === undefined) {
        // Toggle based on current state
        enable = p.mode !== PlayerMode.spectator;
      }
      setSpec(p, enable);
    });
  },
  { aliases: ["sp", "spec"], level: AdminLevel.Moderator }
);

// speed <playerSelector> [amount]
Command(
  "speed",
  (args: any[], source: Player | undefined) => {
    let amount = Number(args[2]) || Number(args[1]) || config.defaultSpeed || 1.5;
    
    let targets = resolvePlayerList(args[1], source);
    // If args[1] was the number, apply to source
    if (targets.length === 0 || !isNaN(Number(args[1]))) {
        if(source) targets = [source];
    }

    if (targets.length === 0) return "You need to be in the game to run this command!";

    targets.forEach((p) => {
      p.spdMult = amount;
    });
  },
  { aliases: ["movespeed", "s", "spd"], level: AdminLevel.Moderator }
);

// weaponvariant [variant] <playerSelector>
Command(
  "weaponvariant",
  (args: any[], source: Player | undefined) => {
    let variant = args[1] || "normal";
    let targets = resolvePlayerList(args[2], source);
    if (targets.length === 0 && source) targets = [source];
    
    if (targets.length === 0) return "Player not found.";

    targets.forEach((p) => setWeaponVariant(p, variant));
  },
  { aliases: ["variant", "wv"], level: AdminLevel.Moderator }
);

// ban [playerSelector] <reason>
Command(
  "ban",
  (args: any[], source: Player | undefined) => {
    let game = getSafeGame();
    if (!game) return;

    let player = playerSelector(args[1], source, false);

    if (player instanceof Player && player.client && !player.client.admin) {
      game.banClient(player.client, args.slice(2).join(" "));
      return false;
    } else {
      return "Invalid Player ID or cannot ban admin.";
    }
  },
  { aliases: ["b"], level: AdminLevel.Staff }
);

// god <playerSelector>
Command(
  "god",
  (args: any[], source: Player | undefined) => {
    let targets = resolvePlayerList(args[1], source);
    if (targets.length === 0 && source) targets = [source];
    if (targets.length === 0) return "Player not found.";

    targets.forEach((p) => {
      p.points = 1000000;
      p.food = Infinity;
      p.wood = Infinity;
      p.stone = Infinity;
      p.age = 29;
      p.xp = Infinity;
      p.invincible = true;
      p.spdMult = 2.5;
    });
  },
  { aliases: ["g", "_god"], level: AdminLevel.Staff }
);

// set [playerID] [resource] [amount]
Command(
  "set",
  (args: any[]) => {
    let playerSID = Number(args[1]);
    let resourceType = args[2]?.toLowerCase();
    let resourceAmount = Number(args[3]) || 0;
    let game = getSafeGame();

    if (game) {
      let player = game.state.players.find((p: any) => p.id == playerSID);

      if (player) {
        switch (resourceType) {
          case "points": case "gold": case "money": case "g": player.points = resourceAmount; break;
          case "food": case "f": player.food = resourceAmount; break;
          case "stone": case "s": player.stone = resourceAmount; break;
          case "wood": case "w": player.wood = resourceAmount; break;
          case "health": case "hp": case "hitpoints": player.health = resourceAmount; break;
          case "xp": player.xp = resourceAmount; break;
          case "age": 
            player.age = resourceAmount - 1; 
            player.xp = Infinity; 
            break;
          case "hat": player.hatID = resourceAmount; break;
          case "accessory": case "acc": player.accID = resourceAmount; break;
          default: return "Invalid resource type " + resourceType;
        }
      } else return "Invalid Player ID";
    }
  },
  { aliases: [], level: AdminLevel.Helper }
);

// kick [playerSelector] <reason>
Command(
  "kick",
  (args: any[], source: Player | undefined) => {
    let reason = args.slice(2).join(" ") || "Kicked by a moderator.";
    let game = getSafeGame();
    if (!game) return;

    let targets = resolvePlayerList(args[1], source);
    if (targets.length === 0) return "Invalid Player ID";

    const srcAdmin = source?.client?.admin || -1;

    targets.forEach((p) => {
      if (p.client) {
        if (p.client.admin >= srcAdmin) return; // Cannot kick equal or higher rank
        game?.kickClient(p.client, reason);
      }
    });
  },
  { aliases: ["k"], level: AdminLevel.Moderator }
);

// generate [type] <size/'dmg'>
Command(
  "generate",
  (args: any[], source: Player | undefined) => {
    if (!source) return "You must be in the game to run this command.";
    let size = Number(args[2]);
    // Clamp size to prevent server crashing
    if (isNaN(size) || size < 1) size = 1;
    if (size > 500) size = 500; 

    let game = getSafeGame();
    game?.generateStructure(
      `${args[1] || "stone"}:${args[2] || "normal"}`,
      source.location.x,
      source.location.y,
      size
    );
    return false;
  },
  { aliases: ["gen"], level: AdminLevel.Staff }
);

// bass - Optimized geometry calculation
Command(
  "bass",
  (args: any[], source: Player | undefined) => {
    if (!source) return "You must be in the game to run this command.";
    let game = getSafeGame();
    if (!game) return;

    let loc = new Vec2(source.location.x, source.location.y);
    let removeRadius = 200;
    let wallGen: number[][] = [];

    // Helper to generate box coords
    const addWall = (x: number, y: number) => wallGen.push([x, y]);
    
    // Build the shape logic (simplified loop)
    let step = 100;
    let count = 10;
    let topY = loc.y - (count + 1) * step;
    let botY = loc.y;
    let leftX = loc.x - (count * step) - step;
    let rightX = loc.x + (count * step);

    // Right Wall
    for(let i=0; i<count; i++) addWall(loc.x + 125 + (i*step), loc.y);
    // Up Wall (Right side)
    for(let i=0; i<count; i++) addWall(rightX - 100, loc.y - (i*step));
    // Left Wall
    for(let i=0; i<count; i++) addWall(loc.x - 125 - (i*step), loc.y);
    // Up Wall (Left side)
    for(let i=0; i<count; i++) addWall(leftX + 100 + step, loc.y - (i*step));
    // Back Wall (Top)
    for(let i=-3; i<(count*2); i++) addWall(leftX + 100 + (i*step), topY);

    // Clear existing objects in area
    let bounds = {
        minX: leftX + 100 - removeRadius, maxX: rightX - 100 + removeRadius,
        minY: topY - removeRadius, maxY: botY + removeRadius
    };

    game.state.gameObjects
      .filter(o => 
         o.location.x > bounds.minX && o.location.x < bounds.maxX &&
         o.location.y > bounds.minY && o.location.y < bounds.maxY
      )
      .forEach(o => {
         if(o && !o.protect) game?.state.removeGameObject(o);
      });

    // Spawn Walls
    wallGen.forEach(w => game?.generateStructure("stone:normal", w[0], w[1], 90));

    // Decorations
    const tl = {x: leftX + 100, y: topY + 100}; // Approx top left corner inside box
    const tr = {x: rightX - 100, y: topY + 100}; 
    
    game.generateStructure("tree:normal", tl.x + 270, tl.y + 140, 120);
    game.generateStructure("stone:normal", tl.x + 200, tl.y + 200, 90);
    game.generateStructure("tree:normal", tr.x - 270, tr.y + 140, 120);
    game.generateStructure("stone:normal", tr.x - 200, tr.y + 200, 90);

    // Fillers (Optimized loop)
    for(let r=0; r<3; r++) { // 3 rows of food
        let y = tl.y + 100 + (r*70);
        for(let c=-3; c<=3; c++) { // 7 cols
            game.generateStructure("food:normal", loc.x + (c*70), y, 70);
        }
    }

    // Gold
    for(let c=-3; c<=3; c++) {
        game.generateStructure("gold:normal", loc.x - 550 + (c*50), tl.y + 650, 65);
        game.generateStructure("gold:normal", loc.x + 550 + (c*50), tl.y + 650, 65);
    }
  },
  { aliases: [], level: AdminLevel.Owner }
);

// trap <playerSelector> - Optimized for Network Batching
Command(
  "trap",
  (args: any[], source: Player | undefined) => {
    let game = getSafeGame();
    if (!game) return;

    let targets: Player[] = [];
    let protect = args[2] == "-lck" || args[1] == "-lck";

    // Resolve targets
    if (args[1] == "*" || args[1] == "**") {
      game.state.players.forEach(p => {
          if (p.id === source?.id && args[1] == "**") return;
          targets.push(p);
      });
    } else {
      targets = resolvePlayerList(args[1], source);
    }

    if (targets.length === 0) return "No targets found.";

    // Batch creation to prevent lag
    targets.forEach(p => {
      if (!game) return;
      let loc = new Vec2(p.location.x, p.location.y);
      let obj = new GameObject(
        game.getNextGameObjectID(),
        loc,
        source?.angle || 0,
        getScale(5),
        -1,
        undefined,
        ItemType.PitTrap,
        source?.id || -1,
        getGameObjHealth(5),
        getGameObjDamage(5),
        protect
      );
      game.state.gameObjects.push(obj);
    });

    // Send updates after all objects are added
    game.state.players.forEach(p => game?.sendGameObjects(p));
    return false;
  },
  { aliases: ["rap", "t", "trp", "tr"], level: AdminLevel.Staff }
);

// pad <playerSelector> - Optimized for Network Batching
Command(
  "pad",
  (args: any[], source: Player | undefined) => {
    let game = getSafeGame();
    if (!game) return;

    let targets: Player[] = [];
    let protect = args[2] == "-lck" || args[1] == "-lck";

    if (args[1] == "*" || args[1] == "**") {
      game.state.players.forEach(p => {
          if (p.id === source?.id && args[1] == "**") return;
          targets.push(p);
      });
    } else {
      targets = resolvePlayerList(args[1], source);
    }

    if (targets.length === 0) return "No targets found.";

    targets.forEach(p => {
      if (!game) return;
      let loc = new Vec2(p.location.x, p.location.y);
      let obj = new GameObject(
        game.getNextGameObjectID(),
        loc,
        source?.angle || 0,
        getScale(6),
        -1,
        undefined,
        ItemType.BoostPad,
        source?.id || -1,
        getGameObjHealth(6),
        getGameObjDamage(6),
        protect
      );
      game.state.gameObjects.push(obj);
    });

    game.state.players.forEach(p => game?.sendGameObjects(p));
    return false;
  },
  { aliases: ["p", "ad", "speedpad"], level: AdminLevel.Staff }
);

// gamemode [mode]
Command(
  "gamemode",
  function (args: any[]) {
    let modes: GameModes[] = args
      .slice(1)
      .map((a: GameModes) => GameModes[a])
      .filter((m) => !!m);
    if (modes.length) {
      let game = getSafeGame();
      if (game) {
        game.mode = modes;
        game.physBounds = [0, config.mapScale];
        if (modes.includes(GameModes.moofieball)) game.ball();
        if (modes.includes(GameModes.survival)) game.survivalMode();
      }
      return false;
    } else return "Invalid GameMode.";
  },
  { aliases: ["gm"], level: AdminLevel.Staff }
);

// cr
Command(
  "cr",
  function (args: any[], source: Player | undefined) {
    if (source) {
      source.items = [
        ItemType.Apple, ItemType.WoodWall, ItemType.Spikes, ItemType.Windmill,
        ItemType.Cookie, ItemType.StoneWall, ItemType.PitTrap, ItemType.BoostPad,
        ItemType.GreaterSpikes, ItemType.FasterWindmill, ItemType.Mine, ItemType.Sapling,
        ItemType.Cheese, ItemType.Turret, ItemType.Platform, ItemType.HealingPad,
        ItemType.Blocker, ItemType.Teleporter, ItemType.CastleWall, ItemType.PowerMill,
        ItemType.PoisonSpikes, ItemType.SpinningSpikes, ItemType.SpawnPad,
      ];
      source.client?.socket.send(
          PacketFactory.getInstance().serializePacket(new Packet(PacketType.UPDATE_ITEMS, [source.items, 0]))
      );
    }
  },
  { aliases: [], level: AdminLevel.Staff }
);

// summon [animalID]
Command(
  "summon",
  function (args: any[], source: Player | undefined) {
    let game = getSafeGame();
    let type = Number(args[1]);
    if (!(type in Animals)) type = Animals.cow;

    if (source && game) {
      game.state.addAnimal(
        game.genAnimalSID(),
        source.location.add(0, 0, true),
        type || 0,
        "Steph"
      );
    }
  },
  { aliases: ["an", "spawn"], level: AdminLevel.Admin }
);

// inspect
Command(
  "inspect",
  function (args: any[], source: Player | undefined) {
    if (!source?.client) return "You must be in the game to use this command.";
    source.selectedWeapon = Weapons.Stick;
    source.weaponMode = WeaponModes.Inspect;
    source.buildItem = -1;
  },
  { aliases: ["ins"], level: AdminLevel.Helper }
);

// onetap
Command(
  "onetap",
  function (args: any[], source: Player | undefined) {
    if (!source?.client) return "You must be in the game to use this command.";
    source.selectedWeapon = Weapons.ToolHammer;
    source.weaponMode = WeaponModes.OneTap;
    source.buildItem = -1;
  },
  { aliases: ["ot"], level: AdminLevel.Admin }
);

// supershot
Command(
  "supershot",
  function (args: any[], source: Player | undefined) {
    if (!source?.client) return "You must be in the game to use this command.";
    source.selectedWeapon = Weapons.Shotgun;
    source.weaponMode = WeaponModes.SuperShot;
    source.buildItem = -1;
  },
  { aliases: ["supers"], level: AdminLevel.Admin }
);

// bigshot
Command(
  "bigshot",
  function (args: any[], source: Player | undefined) {
    if (!source?.client) return "You must be in the game to use this command.";
    source.selectedWeapon = Weapons.Shotgun;
    source.weaponMode = WeaponModes.BigShot;
    source.buildItem = -1;
  },
  { aliases: ["bigs"], level: AdminLevel.Admin }
);

// logs
Command(
  "logs",
  function (args: any[], source: Player | undefined) {
    if (source?.client) return Broadcast("Must use in console.", source.client);
    console.log("\n" + logger.returnLogs(Number(args[1]) || 15));
  },
  { aliases: [], level: AdminLevel.Admin }
);

// exec [js]
Command(
  "exec",
  function (args: any[], source: Player | undefined) {
    let out = getGame()?.exec(args.slice(1).join(" "), source) || [false, ""];
    source?.client && Broadcast(String(out[1]), source?.client);
  },
  { aliases: ["xec"], level: AdminLevel.Meow }
);

// Account Management
Command(
  "acc.promote",
  function (args: any[], source: Player | undefined) {
    let level = AdminLevel.Admin;
    if (Number(args[args.length - 1])) level = Number(args.pop());
    let account = getAccount(args.slice(1).join(" ") || "");
    
    if (!account || !account.username) {
      let msg = "Invalid username.";
      return source?.client ? Broadcast(msg, source.client) : console.log(msg);
    }
    
    if (!AdminLevel[level]) level = AdminLevel.Admin;
    account.adminLevel = level;
    setAccount(account.username, account);
    
    getGame()?.state.players.forEach((plr) => {
        if (plr.client?.account && plr.client.account.username == account?.username) {
            getGame()?.kickClient(plr.client, "Promoted.");
        }
    });
  },
  { aliases: [], level: AdminLevel.Meow }
);

Command(
  "acc.demote",
  function (args: any[], source: Player | undefined) {
    let account = getAccount(args.slice(1).join(" ") || "");
    if (!account || !account.username) {
      let msg = "Invalid username.";
      return source?.client ? Broadcast(msg, source.client) : console.log(msg);
    }
    account.adminLevel = 0;
    setAccount(account.username, account);
    getGame()?.state.players.forEach((plr) => {
        if (plr.client?.account && plr.client.account.username == account?.username) {
            getGame()?.kickClient(plr.client, "Demoted.");
        }
    });
  },
  { aliases: [], level: AdminLevel.Meow }
);

Command(
  "acc.delete",
  function (args: any[], source: Player | undefined) {
    let account = getAccount(args.slice(1).join(" ") || "");
    if (!account || !account.username) {
      let msg = "Invalid username.";
      return source?.client ? Broadcast(msg, source.client) : console.log(msg);
    }
    db.delete(`account_${account.username.replace(/ /g, "+")}`);
    getGame()?.state.players.forEach((plr) => {
        if (plr.client?.account && plr.client.account.username == account?.username) {
            getGame()?.kickClient(plr.client, "Account Deleted.");
        }
    });
  },
  { aliases: [], level: AdminLevel.Owner }
);

Command(
  "acc.setyt",
  function (args: any[], source: Player | undefined) {
    let yt = String(args.pop()) || "";
    let account = getAccount(args.slice(1).join(" ") || "");
    if (!account || !account.username) return source?.client && Broadcast("Invalid username.", source.client);
    if (!yt) return Broadcast("Invalid url.", source?.client);

    account.mootuber = yt;
    setAccount(account.username, account);
  },
  { aliases: ["acc.setyoutube"], level: AdminLevel.Admin }
);

Command(
  "acc.setpass",
  function (args: any[], source: Player | undefined) {
    let newpass = args.pop();
    let account = getAccount(args.slice(1).join(" ") || "");
    if (!account || !account.username) return source?.client && Broadcast("Invalid username.", source.client);

    bcrypt.hash(newpass, 5, (err: any, hash: any) => {
      if (err || !account) return Broadcast("Error hashing password.", source?.client);
      account.password = hash;
      setAccount(account.username, account);
      Broadcast("Password Changed.", source?.client);
    });
  },
  { aliases: ["acc.changepass"], level: AdminLevel.Meow }
);

Command(
  "acc.gtribe",
  function (args: any[], source: Player | undefined) {
    // Logic appears incomplete in source, preserving structure
    let gtr = getGTribe(args.pop());
    let account = getAccount(args.slice(1).join(" ") || "");
    if (!gtr || !account) return Broadcast("Invalid params.", source?.client);
  },
  { aliases: [], level: AdminLevel.Meow }
);

// Custom Loadout Commands
function applyLoadout(source: Player, packetFactory: any, loadout: any, message: string) {
    if (!source.client) return;
    
    Object.assign(source, loadout);
    getGame()?.sendPlayerUpdates();

    let packets = [
        new Packet(PacketType.UPDATE_ITEMS, [source.items, 0]),
        new Packet(PacketType.UPDATE_ITEMS, [[source.weapon, source.secondaryWeapon], 1]),
        new Packet(PacketType.UPGRADES, [0, 0]),
        new Packet(PacketType.HEALTH_CHANGE, [source.location.x, source.location.y, message, 1]),
        new Packet(PacketType.EVAL, [`document.getElementById("chatBox").setAttribute("maxlength",999999);`]),
    ];
    packets.forEach(p => source.client && source.client.socket.send(packetFactory.serializePacket(p)));
}

Command(
  "meow",
  (args: any[], source: Player | undefined) => {
    if (source && source.client) {
        applyLoadout(source, PacketFactory.getInstance(), {
            weapon: Weapons.Katana, selectedWeapon: Weapons.Katana,
            secondaryWeapon: Weapons.Shotgun,
            primaryWeaponExp: WeaponVariants[WeaponVariant.Amethyst].xp,
            items: [ItemType.Cookie, ItemType.CastleWall, ItemType.SpinningSpikes, ItemType.PowerMill, ItemType.PitTrap, ItemType.BoostPad, ItemType.Teleporter],
            food: 10000, stone: 10000, wood: 10000, points: 50000, health: 100,
            invincible: true, spdMult: 3, upgradeAge: 10, age: 99, xp: Infinity,
            hatID: 59, accID: 11
        }, ":3");
    }
  },
  { aliases: ["m"], level: AdminLevel.Meow }
);

Command(
  "thwampus",
  (args: any[], source: Player | undefined) => {
    if (source && source.client) {
        applyLoadout(source, PacketFactory.getInstance(), {
            weapon: Weapons.Katana, selectedWeapon: Weapons.Katana,
            secondaryWeapon: Weapons.GreatHammer,
            primaryWeaponExp: WeaponVariants[WeaponVariant.Amethyst].xp,
            secondaryWeaponExp: WeaponVariants[WeaponVariant.Amethyst].xp,
            items: [ItemType.PitTrap, ItemType.BoostPad, ItemType.Mine, ItemType.Sapling, ItemType.Cheese, ItemType.Turret, ItemType.Platform, ItemType.HealingPad, ItemType.Blocker, ItemType.Teleporter, ItemType.CastleWall, ItemType.PowerMill, ItemType.PoisonSpikes, ItemType.SpinningSpikes, ItemType.SpawnPad],
            food: Infinity, stone: Infinity, wood: Infinity, points: 0, health: 100,
            invincible: true, spdMult: 4, upgradeAge: 10, age: 99, xp: Infinity,
            hatID: 60, accID: 21
        }, "W U M P");
    }
  },
  { aliases: ["wump"], level: AdminLevel.Owner }
);

Command(
  "dashre",
  (args: any[], source: Player | undefined) => {
    if (source && source.client) {
        applyLoadout(source, PacketFactory.getInstance(), {
            weapon: Weapons.Sword, selectedWeapon: Weapons.Sword,
            secondaryWeapon: Weapons.GreatHammer,
            primaryWeaponExp: WeaponVariants[WeaponVariant.Diamond].xp,
            secondaryWeaponExp: WeaponVariants[WeaponVariant.Diamond].xp,
            items: [ItemType.PitTrap, ItemType.BoostPad],
            food: 10000, stone: 10000, wood: 10000, points: 10000, health: 100,
            invincible: true, spdMult: 8, upgradeAge: 10, age: 99, xp: Infinity,
            hatID: 61, accID: 11
        }, ":3");
    }
  },
  { aliases: ["dash"], level: AdminLevel.Owner }
);

Command(
  "gphat",
  function (args: any[], source: Player | undefined) {
    if (source && source.client) {
      source.hatID = 63;
    }
  },
  { aliases: [], level: AdminLevel.Moderator }
);

// lock [password]
Command(
  "lock",
  (args: any[], source: Player | undefined) => {
    let game = getSafeGame();
    if (!game) return;

    game.locked = args.slice(1).join(" ") || "";
    game.state.players.forEach((p) => {
      if(p.client) game?.kickClient(p.client, "Server locked. Get the password from an admin.");
    });
  },
  { aliases: ["lockdown", "lockserver", "ls"], level: AdminLevel.Admin }
);

// snake [playerSelector] - Fixed Memory Leaks
Command(
  "snake",
  (args: any[], source: Player | undefined) => {
    let game = getSafeGame();
    if (!game || !source) return;

    let targets = resolvePlayerList(args[1], source);
    
    let len = 0;
    targets.forEach((p) => {
      if (p.id == source.id) return;
      len += 100;
      let dist = Number(len);
      
      // Fix: Clear existing intervals to prevent exponential lag
      if ((p as any).snakeInterval) clearInterval((p as any).snakeInterval);

      (p as any).snakeInterval = setInterval(function () {
        // Cleanup check
        if (source.dead || !source || !game?.state.players.find((pl) => pl.id == source.id) || !p || p.dead) {
          clearInterval((p as any).snakeInterval);
          return;
        }
        
        let ang = (source.angle * 180) / Math.PI;
        ang = (ang + 180) % 360;
        let rad = (ang * Math.PI) / 180.0;
        let x = Math.cos(rad);
        let y = Math.sin(rad);
        
        p.location = source.location.add(x * dist, y * dist, true);
      }, 100);
    });
  },
  { aliases: [], level: AdminLevel.Admin }
);

// --- Console Logic ---

function logMethod(text: string) {
  process.stdout.write(
    ansiEscapes.eraseLines(lastMessage.split("\n").length) + text
  );
  lastMessage = text;
}

function log(text: any) {
  let commandParts = command.split(" ");
  let coloredCommand =
    chalk.yellow(commandParts[0]) +
    (commandParts.length > 1 ? " " : "") +
    commandParts.slice(1).join(" ");

  logMethod(text.toString());
  process.stdout.write("\n");
  logMethod("> " + coloredCommand);
}

function error(text: string) {
  process.stderr.write(ansiEscapes.eraseLines(lastMessage.split("\n").length));
  console.error(text);
}

function runCommand(commandStr: string, source?: Player) {
  try {
    let cmdObj = GetCommand(commandStr);
    if(!cmdObj) return false;

    let err = cmdObj.execute(commandStr, source);
    if (err && source?.client) Broadcast(err, source.client);
    
    const logMsg = `Ran "${commandStr}" from ${source ? `${source.name} (${source.id})` : "CONSOLE"}.`;
    console.log(logMsg);
    logger.log(logMsg);
    
    return true;
  } catch (e) {
    const errMsg = `Error executing command: ${e}`;
    console.error(errMsg);
    if (source?.client) Broadcast("Internal Error.", source.client);
    return false;
  }
}

function startConsole() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  function consoleLoop() {
    rl.question("> ", (input) => {
      command = input.trim();
      if (command == "exit") {
        console.log("Closing...");
        process.exit();
      }

      if (command.startsWith("/")) command = command.substring(1);

      if (command.length > 0) {
         if (!runCommand(command)) {
             error("Invalid command or execution failed.");
         }
      }
      consoleLoop();
    });
  }
  consoleLoop();
}

export { startConsole, log, runCommand };
