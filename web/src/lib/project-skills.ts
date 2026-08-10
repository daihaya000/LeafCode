import fs from "node:fs";
import path from "node:path";

const MAX_SKILL_FILE_BYTES = 2 * 1024 * 1024;

export const SAFE_SKILL_NAME = /^[A-Za-z0-9._-]+$/;

export type ProjectSkillDto = {
  name: string;
  path: string;
  relativePath: string;
  exists: boolean;
  content: string;
};

function skillsDir(root: string): string {
  return path.join(root, ".opencode", "skills");
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertSkillName(name: string): void {
  if (!SAFE_SKILL_NAME.test(name)) {
    throw new Error("スキル名は英数字・ドット・アンダースコア・ハイフンのみ使用できます");
  }
}

function skillPath(root: string, name: string): string {
  return path.join(skillsDir(root), name, "SKILL.md");
}

function toDto(root: string, name: string, file: string, content: string): ProjectSkillDto {
  return {
    name,
    path: file,
    relativePath: path.relative(root, file).split(path.sep).join("/"),
    exists: true,
    content,
  };
}

export function listProjectSkills(root: string): ProjectSkillDto[] {
  const dir = skillsDir(root);
  if (!fs.existsSync(dir)) return [];

  const skills: ProjectSkillDto[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SAFE_SKILL_NAME.test(entry.name)) continue;
    try {
      const file = skillPath(root, entry.name);
      if (!fs.existsSync(file)) continue;
      const real = fs.realpathSync.native(file);
      if (!isWithinRoot(root, real) || !fs.statSync(real).isFile()) continue;
      const size = fs.statSync(real).size;
      const content = size <= MAX_SKILL_FILE_BYTES ? fs.readFileSync(real, "utf8") : "";
      skills.push(toDto(root, entry.name, real, content));
    } catch {
      // Ignore entries that cannot be read without failing the entire list.
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

export function readProjectSkill(root: string, name: string): ProjectSkillDto {
  assertSkillName(name);
  const file = skillPath(root, name);
  if (!fs.existsSync(file)) {
    return {
      name,
      path: file,
      relativePath: path.relative(root, file).split(path.sep).join("/"),
      exists: false,
      content: "",
    };
  }
  const real = fs.realpathSync.native(file);
  if (!isWithinRoot(root, real) || !fs.statSync(real).isFile()) {
    throw new Error(`スキル「${name}」を安全に読み込めません`);
  }
  if (fs.statSync(real).size > MAX_SKILL_FILE_BYTES) {
    throw new Error(`スキル「${name}」は2MBを超えているため編集できません`);
  }
  return toDto(root, name, real, fs.readFileSync(real, "utf8"));
}

export function writeProjectSkill(root: string, name: string, content: string): ProjectSkillDto {
  assertSkillName(name);
  if (Buffer.byteLength(content, "utf8") > MAX_SKILL_FILE_BYTES) {
    throw new Error("スキル定義は2MB以内で指定してください");
  }
  const file = skillPath(root, name);
  const dir = path.dirname(file);
  for (const candidate of [path.join(root, ".opencode"), skillsDir(root), dir]) {
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`スキル「${name}」はシンボリックリンクのため編集できません`);
    }
  }
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw new Error(`スキル「${name}」はシンボリックリンクのため編集できません`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const realDir = fs.realpathSync.native(dir);
  if (!isWithinRoot(root, realDir)) {
    throw new Error(`スキル「${name}」の保存先がプロジェクト外です`);
  }
  fs.writeFileSync(file, content, "utf8");
  return toDto(root, name, file, content);
}

export function deleteProjectSkill(root: string, name: string): void {
  assertSkillName(name);
  const dir = path.join(skillsDir(root), name);
  if (!fs.existsSync(dir)) return;
  if (fs.lstatSync(dir).isSymbolicLink()) {
    throw new Error(`スキル「${name}」はシンボリックリンクのため削除できません`);
  }
  const real = fs.realpathSync.native(dir);
  if (!isWithinRoot(root, real) || !fs.statSync(real).isDirectory()) {
    throw new Error(`スキル「${name}」を安全に削除できません`);
  }
  fs.rmSync(real, { recursive: true, force: true });
}
