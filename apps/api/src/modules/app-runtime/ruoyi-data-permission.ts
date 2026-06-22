/**
 * 给若依 codegen 产的 Mapper 注入 `@DataPermission`（坎2：data_scope 真生效）。
 *
 * 背景：RuoYi-Vue-Plus 的数据权限靠 MyBatis 拦截器按当前登录用户的角色 data_scope 改写 SQL，
 * 但 **codegen 产的 Mapper 不带 @DataPermission**，所以 list 查询从不过滤——"普通用户(data_scope=5)
 * 只看自己"开箱不工作。这里在部署落盘 Mapper 时打补丁：覆盖 selectVoPage/selectVoList 加注解。
 *   - userName → `create_by`（仅本人=自己录入的；data_scope=5 据此过滤；insert 由若依自动填）
 *   - deptName → `create_dept`（本部门/及以下；data_scope=3/4 用；与若依基础列对齐）
 * data_scope=1(全部) 的角色不被过滤；故对每个业务 Mapper 一律注入，按角色 data_scope 各自生效。
 */
const USER_COLUMN = 'create_by';
const DEPT_COLUMN = 'create_dept';

const IMPORT_ANCHOR = 'import org.dromara.common.mybatis.core.mapper.BaseMapperPlus;';
const EXTRA_IMPORTS = [
  IMPORT_ANCHOR,
  'import com.baomidou.mybatisplus.core.conditions.Wrapper;',
  'import com.baomidou.mybatisplus.core.metadata.IPage;',
  'import org.dromara.common.mybatis.annotation.DataColumn;',
  'import org.dromara.common.mybatis.annotation.DataPermission;',
  'import java.util.List;',
].join('\n');

function overrides(entity: string, vo: string): string {
  const ann = `    @DataPermission({\n        @DataColumn(key = "deptName", value = "${DEPT_COLUMN}"),\n        @DataColumn(key = "userName", value = "${USER_COLUMN}")\n    })`;
  return [
    '',
    '    @Override',
    ann,
    `    default <P extends IPage<${vo}>> P selectVoPage(IPage<${entity}> page, Wrapper<${entity}> wrapper) {`,
    '        return selectVoPage(page, wrapper, this.currentVoClass());',
    '    }',
    '',
    '    @Override',
    ann,
    `    default List<${vo}> selectVoList(Wrapper<${entity}> wrapper) {`,
    '        return selectVoList(wrapper, this.currentVoClass());',
    '    }',
    '',
  ].join('\n');
}

/**
 * 注入 @DataPermission。返回补丁后源码；无法识别(非标准 Mapper)或已注入则原样返回。
 */
export function injectDataPermission(src: string): string {
  if (src.includes('@DataPermission')) return src; // 幂等：已注入
  const m = src.match(/interface\s+\w+\s+extends\s+BaseMapperPlus<\s*(\w+)\s*,\s*(\w+)\s*>/);
  if (!m) return src; // 非标准 BaseMapperPlus Mapper，不动
  const [entity, vo] = [m[1], m[2]];
  if (!src.includes(IMPORT_ANCHOR)) return src; // 没有锚点 import，保守不改
  const lastBrace = src.lastIndexOf('}');
  if (lastBrace < 0) return src;
  const withImports = src.replace(IMPORT_ANCHOR, EXTRA_IMPORTS);
  // 在接口体最后一个 } 前插入覆盖方法（基于补丁后字符串重新定位 } ）
  const lb = withImports.lastIndexOf('}');
  return withImports.slice(0, lb) + overrides(entity, vo) + withImports.slice(lb);
}
