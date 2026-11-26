const db = require('../config/db');
async function balance(conn, type, id) {
 const [r]=await conn.execute(`SELECT COALESCE(SUM(CASE WHEN movement_type IN ('OPENING','RECEIPT','PRODUCTION_IN','RETURN_IN','ADJUSTMENT_IN') THEN quantity ELSE -quantity END),0) balance FROM stock_ledger WHERE item_type=? AND item_id=?`,[type,id]);
 return Number(r[0].balance);
}
async function movement(conn,m,userId=null){
 await conn.execute(`INSERT INTO stock_ledger(item_type,item_id,movement_type,quantity,unit,unit_cost,source_type,source_id,notes,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)`,[m.type,m.id,m.kind,m.qty,m.unit,m.cost||0,m.source,m.sourceId,m.notes||null,userId]);
}
async function audit(conn,userId,action,type,id,after,ip=''){
 await conn.execute(`INSERT INTO audit_logs(user_id,action,entity_type,entity_id,after_data,ip_address) VALUES(?,?,?,?,?,?)`,[userId,action,type,id,JSON.stringify(after||{}),ip]);
}
module.exports={balance,movement,audit};
