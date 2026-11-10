"use client";
// 销售变化 (S01): 独立的输入/过程/输出。变化口径由服务端确定性计算。

import {Neo2Shell} from '../../../components/neo2/shell';
import {AnalysisWorkspaceView} from '../../../components/neo2/analysis-view';

export default function Page() {
    return (
        <Neo2Shell
            active="sales-change"
            title="销售变化"
            subtitle="对比当前快照与基线快照：全店变化与款贡献，全部为服务端计算结果。"
        >
            <AnalysisWorkspaceView
                workspace="sales-change"
                notes={[
                    '不选基线快照时按零基线处理：销售额变化仍可计算，变化率显示「不可计算（基线为零）」。',
                    'day_sku 粒度不产出订单数与客单价：订单数变化将显示「不支持（数据粒度不支持）」。',
                    '部分行缺成本时毛利变化显示「不可计算（成本数据部分缺失）」，且不影响销售额计算。',
                ]}
            />
        </Neo2Shell>
    );
}
