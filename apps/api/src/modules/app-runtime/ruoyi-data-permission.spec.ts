import { injectDataPermission } from './ruoyi-data-permission';

const CUSTOMER_MAPPER = `package org.dromara.system.mapper;

import org.dromara.system.domain.Customer;
import org.dromara.system.domain.vo.CustomerVo;
import org.dromara.common.mybatis.core.mapper.BaseMapperPlus;

public interface CustomerMapper extends BaseMapperPlus<Customer, CustomerVo> {

}
`;

describe('injectDataPermission（坎2：给 codegen Mapper 注入数据权限）', () => {
  it('空 Mapper → 注入 @DataPermission + 覆盖 selectVoPage/selectVoList + 正确泛型', () => {
    const out = injectDataPermission(CUSTOMER_MAPPER);
    expect(out).toContain('@DataPermission');
    expect(out).toContain('value = "create_by"'); // 仅本人按 create_by
    expect(out).toContain('value = "create_dept"'); // 部门列对齐若依基础列
    expect(out).toContain('default <P extends IPage<CustomerVo>> P selectVoPage(IPage<Customer> page'); // 泛型正确
    expect(out).toContain('default List<CustomerVo> selectVoList(Wrapper<Customer> wrapper)');
    // 必要 import 注入
    expect(out).toContain('import org.dromara.common.mybatis.annotation.DataPermission;');
    expect(out).toContain('import com.baomidou.mybatisplus.core.metadata.IPage;');
    // 保留原 BaseMapperPlus import 锚点（未丢）
    expect(out).toContain('import org.dromara.common.mybatis.core.mapper.BaseMapperPlus;');
  });

  it('幂等：已含 @DataPermission → 原样返回（不重复注入）', () => {
    const once = injectDataPermission(CUSTOMER_MAPPER);
    const twice = injectDataPermission(once);
    expect(twice).toBe(once);
  });

  it('非标准 Mapper（不 extends BaseMapperPlus）→ 不动', () => {
    const weird = 'package x;\npublic interface FooMapper { }\n';
    expect(injectDataPermission(weird)).toBe(weird);
  });
});
