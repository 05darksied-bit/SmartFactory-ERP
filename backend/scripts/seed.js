require('dotenv').config();
const bcrypt=require('bcryptjs');
const db=require('../config/db');

async function main(){
 const ifEmpty=process.argv.includes('--if-empty')||process.env.SEED_IF_EMPTY==='true';
 const c=await db.getConnection();
 try{
  if(ifEmpty){
   const [[u]]=await c.query('SELECT COUNT(*) AS cnt FROM users');
   const [[p]]=await c.query("SELECT COUNT(*) AS cnt FROM products WHERE sku='MUR-200'");
   if(Number(u.cnt)>0&&Number(p.cnt)>0){
    console.log('[SEED] Database already initialized with benchmark master data; skipping seed.');
    return;
   }
  }
  await c.query('SET FOREIGN_KEY_CHECKS=0');
  const resetTables=['sales_visits','quality_inspections','supplier_payments','purchase_returns','stock_batches','audit_logs','credit_notes','payments','dispatch_items','dispatches','invoices','invoice_sequences','sales_order_items','sales_orders','production_consumption','production_runs','stock_ledger','purchase_items','purchases','bom_items','boms','customers','suppliers','inventory_items','products'];
  for(const t of resetTables) await c.query(`TRUNCATE TABLE ${t}`);
  await c.query('SET FOREIGN_KEY_CHECKS=1');
  await c.beginTransaction();
  const hash=await bcrypt.hash('ChangeMe123!',12);
  const users=[['Factory Owner','owner@smartfactory.local','OWNER'],['Factory Admin','admin@smartfactory.local','ADMIN'],['Salesman A','salesman@smartfactory.local','SALESMAN'],['Salesman B','salesmanb@smartfactory.local','SALESMAN'],['Production Supervisor','production@smartfactory.local','PRODUCTION'],['Auditor','auditor@smartfactory.local','ACCOUNTANT']];
  for(const [name,email,role] of users) await c.execute('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),password_hash=VALUES(password_hash),role=VALUES(role)',[name,email,hash,role]);
  const [[owner]]=await c.execute("SELECT id FROM users WHERE email='owner@smartfactory.local'");
  const [supplier]=await c.execute('INSERT INTO suppliers(name,state_code) VALUES(?,?)',['Tamil Nadu Flour Mills','33']);
  await c.execute('INSERT INTO customers(name,customer_type,state_code,gstin,address) VALUES(?,?,?,?,?)',['Retailer A','RETAILER','33','33AAAAA0000A1Z5','Tamil Nadu, India']);
  await c.execute('INSERT INTO customers(name,customer_type,state_code,gstin,address) VALUES(?,?,?,?,?)',['Distributor B','DISTRIBUTOR','29','29BBBBB0000B1Z5','Karnataka, India']);
  const [product]=await c.execute('INSERT INTO products(sku,name,pack_size,expected_yield,selling_price,hsn_code,gst_rate) VALUES(?,?,?,?,?,?,?)',['MUR-200','Murukku','200 g',200,50,'190590',5]);
  const inventory=[['RAW-FLOUR','Flour','RAW','kg',100,42,30],['RAW-OIL','Cooking oil','RAW','litre',30,140,8],['RAW-SPICE','Salt and spice mix','RAW','kg',5,200,2],['PKG-POUCH','200 g pouch','PACKAGING','piece',500,2.5,400],['PKG-CARTON','Carton (20 packets)','PACKAGING','piece',30,15,25]];
  const ids={};
  for(const [sku,name,type,unit,qty,cost,reorder] of inventory){const [r]=await c.execute('INSERT INTO inventory_items(sku,name,item_type,base_unit,reorder_level) VALUES(?,?,?,?,?)',[sku,name,type,unit,reorder]);ids[sku]=r.insertId;await c.execute('INSERT INTO stock_ledger(item_type,item_id,movement_type,quantity,unit,unit_cost,source_type,source_id,created_by) VALUES(?,? ,\'OPENING\',?,?,?,\'SEED_OPENING\',?,?)',[type,r.insertId,qty,unit,cost,r.insertId,owner.id]);}
  await c.execute("INSERT INTO stock_ledger(item_type,item_id,movement_type,quantity,unit,source_type,source_id,created_by) VALUES('FINISHED',?,'OPENING',50,'packet','SEED_OPENING',?,?)",[product.insertId,product.insertId,owner.id]);
  const [bom]=await c.execute('INSERT INTO boms(product_id,version_no,is_active) VALUES(?,1,1)',[product.insertId]);
  const recipe=[['RAW-FLOUR',40,'kg','RAW'],['RAW-OIL',10,'litre','RAW'],['RAW-SPICE',1.2,'kg','RAW'],['PKG-POUCH',200,'piece','PACKAGING'],['PKG-CARTON',10,'piece','PACKAGING']];
  for(const [sku,qty,unit,type] of recipe) await c.execute('INSERT INTO bom_items(bom_id,item_id,item_type,quantity_per_batch,unit) VALUES(?,?,?,?,?)',[bom.insertId,ids[sku],type,qty,unit]);
  const [purchase]=await c.execute('INSERT INTO purchases(supplier_id,invoice_number,purchase_date,total_amount,created_by) VALUES(?,?,?,?,?)',[supplier.insertId,'TNFM-OPEN-001',new Date().toISOString().slice(0,10),'2700.00',owner.id]);
  await c.execute('INSERT INTO purchase_items(purchase_id,item_id,quantity,unit,rate) VALUES(?,?,60,\'kg\',45)',[purchase.insertId,ids['RAW-FLOUR']]);
  await c.execute("INSERT INTO stock_ledger(item_type,item_id,movement_type,quantity,unit,unit_cost,source_type,source_id,created_by) VALUES('RAW',?,'RECEIPT',60,'kg',45,'PURCHASE',?,?)",[ids['RAW-FLOUR'],purchase.insertId,owner.id]);
  await c.commit();
  console.log('Seed complete: benchmark masters, opening stock and flour purchase loaded.');
  console.log('Demo password for all roles: ChangeMe123!');
 }catch(e){await c.rollback();throw e}finally{c.release();await db.end()}
}
main().catch(e=>{console.error(e);process.exit(1)});
